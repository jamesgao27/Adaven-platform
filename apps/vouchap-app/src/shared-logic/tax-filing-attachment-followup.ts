import {
  getProjectTodoAttachmentWithContext,
  getProjectTodoAttachmentById,
  updateProjectTodoAttachment,
} from './firm';
import { classificationLabelsForTaxFilingPrompt } from './tax-filing-project-classification-labels';
import { runTaxFilingRecognition } from './tax-filing-recognition-run';
import { runWithRecognitionRetry, getUserFacingMessage } from './recognition-retry';
import { buildTaxFilingAttachmentDefaultDisplayName } from './tax-filing-attachment-display-name';
import { assertClientRecognitionAllowed, recordClientRecognitionSuccessIfEnforced } from './client-recognition-quota';

export type TaxFilingAttachmentFollowupResult =
  | { ok: true }
  | { ok: false; alertMessage: string };

/**
 * After createProjectTodoAttachment from Todos / order screens: recognition and DB update only.
 * Chat history is written only when the user submits from chat-to-log (see saveChatLog there).
 */
export async function processTaxFilingAttachmentAfterCreate(params: {
  attachmentId: string;
  todoId: string;
  fileName: string;
  isImage: boolean;
}): Promise<TaxFilingAttachmentFollowupResult> {
  await updateProjectTodoAttachment(params.attachmentId, { status: 'PROCESSING', recognition_fail_count: 0 });

  const ctx = await getProjectTodoAttachmentWithContext(params.attachmentId);
  if (!ctx) {
    return { ok: false, alertMessage: 'Could not load attachment context.' };
  }

  const { attachment, project, todoContext } = ctx;
  const quotaSpaceId = project.clientSpaceId ?? '';
  const gate = await assertClientRecognitionAllowed(quotaSpaceId);
  if (!gate.allowed) {
    await updateProjectTodoAttachment(params.attachmentId, {
      status: 'FAILED_ONCE',
      recognition_fail_count: 1,
    });
    return { ok: false, alertMessage: gate.message ?? 'Recognition is not available for this account right now.' };
  }
  const classificationLabels = classificationLabelsForTaxFilingPrompt(project);
  const projectContext = {
    country: (project.taxCountry === 'USA' ? 'USA' : 'CANADA') as 'CANADA' | 'USA',
    taxScenario: project.taxScenario ?? '',
    ...(classificationLabels.length > 0 ? { classificationLabels } : {}),
  };

  const recognizeFn = () => runTaxFilingRecognition(attachment.attachment_url, projectContext, todoContext);

  const recognitionResult = await runWithRecognitionRetry(recognizeFn, {
    maxAttempts: 3,
    delayMs: 1500,
  });

  if (!recognitionResult.success) {
    const latest = await getProjectTodoAttachmentById(params.attachmentId);
    const currentFailCount =
      latest?.recognition_fail_count != null ? Number(latest.recognition_fail_count) || 0 : 0;
    const nextFailCount = Math.min(currentFailCount + 1, 3);
    const nextStatus =
      nextFailCount >= 3 ? 'FAILED_FINAL' : nextFailCount === 2 ? 'FAILED_TWICE' : 'FAILED_ONCE';

    await updateProjectTodoAttachment(params.attachmentId, {
      status: nextStatus,
      recognition_fail_count: nextFailCount,
    });

    const errText = recognitionResult.isContentQuality
      ? 'Content unclear or not recognized. Please resubmit.'
      : getUserFacingMessage(recognitionResult);
    return { ok: false, alertMessage: `Recognition failed: ${errText}` };
  }

  const recognition = recognitionResult.result as Awaited<ReturnType<typeof runTaxFilingRecognition>>;
  const displayName = buildTaxFilingAttachmentDefaultDisplayName({
    summary: recognition.summary,
    docType: recognition.doc_type,
    sourceFileName: params.fileName,
  });
  const upd = await updateProjectTodoAttachment(params.attachmentId, {
    summary: recognition.summary,
    doc_type: recognition.doc_type,
    extracted_data: recognition.extracted_data,
    status: 'PROCESSED',
    recognition_fail_count: 0,
    display_name: displayName,
  });
  if ('error' in upd) {
    return { ok: false, alertMessage: upd.error.message ?? 'Could not update attachment.' };
  }

  await recordClientRecognitionSuccessIfEnforced(quotaSpaceId);
  return { ok: true };
}
