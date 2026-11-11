# send-invitation-email

Shared Edge Function for **Portalflow / Vouchap / Wholestore / Workmap**.

Uses the project’s Auth SMTP + **Invite user** template (`inviteUserByEmail`).

| `kind` | Table | Inviter column | Email column |
|--------|--------|----------------|--------------|
| `space` (default) | `space_invitations` | `inviter_id` | `invitee_email` |
| `workspace` | `workspace_invitations` | `invited_by_user_id` | `invited_email` |

Body: `email`, `inviteUrl`, `invitationId`, `inviterName`, `spaceName?`, `isExistingUser?`, `kind?`.

Deploy from each app that vendors a copy, or from this package path with `--project-ref`.
