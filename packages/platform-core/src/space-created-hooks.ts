/**
 * Product-agnostic Space lifecycle hook.
 * Platform core creates membership only; each app registers seeds/roles here.
 */

export type SpaceCreatedContext = {
  spaceId: string;
  name: string;
  kind?: string;
  clientProfileType?: string;
};

export type OnSpaceCreatedHandler = (ctx: SpaceCreatedContext) => Promise<void>;

let onSpaceCreatedHandler: OnSpaceCreatedHandler | null = null;

export function registerOnSpaceCreated(handler: OnSpaceCreatedHandler): void {
  onSpaceCreatedHandler = handler;
}

export async function runOnSpaceCreated(ctx: SpaceCreatedContext): Promise<void> {
  if (!onSpaceCreatedHandler) return;
  await onSpaceCreatedHandler(ctx);
}
