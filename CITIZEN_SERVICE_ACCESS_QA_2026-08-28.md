# Citizen Service Access QA — 2026-08-28

## Scope

This check covers the revised citizen access flow. Service details and forms remain public to read and complete. Request creation remains protected by a valid citizen session, verified identity state, a short face video, and explicit consent to attach that video to the request.

## Visual verification

| Viewport | Result | Observations |
|---|---|---|
| Desktop — 1440 × 1200 | Pass | The government header, service hero, three-step progress strip, public viewing notice, and service fields are visible with clear RTL hierarchy. The notice makes the submit-time login and face-verification boundary explicit. |
| Mobile — 390 × 844 | Pass | The header, hero, progress strip, account/face-verification notice, and start of the service form reflow without horizontal clipping or overlapping controls. |

## Functional verification

| Check | Result |
|---|---|
| Guest can open a generic local form | Pass |
| Guest can open the specialized store-license form | Pass |
| Guest has no citizen portal sidebar and sees no fabricated citizen identity data | Pass |
| Guest submit saves textual draft and routes to `/onboarding?continue=/service/water-complaint` | Pass |
| Verified citizen sees required face-video capture and explicit consent | Pass |
| UI rejects submit without both the face video and consent | Pass |
| Saved verified session returns to the requested service and restores its draft | Pass |
| Anonymous HTTP submission to generic and specialized endpoints | Rejected with `401` |
| `pnpm build` and `git diff --check` | Pass |

## Privacy and access notes

The short face video is submitted only after the authenticated, verified citizen consents. The server validates it as video content, encrypts it as protected media, and attaches it to the specific service request or specialized application. It is not exposed by the public service page.

This flow records a face-video attachment for the request; it does **not** claim automated biometric identity approval. Identity approval remains subject to the established authorized review workflow.
