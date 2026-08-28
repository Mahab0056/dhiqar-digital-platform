# Citizen Navigation and Notifications QA — 2026-08-28

## Scope

This check covers the citizen portal navigation shown on mobile and the notification entry points. The change turns the notification entry into an authenticated citizen page rather than an in-page hash link, and makes portal navigation use native anchors so hash destinations work reliably on mobile browsers.

## Verified behavior

| Check | Result |
|---|---|
| Mobile menu opens from its menu button | Pass |
| Selecting **الخدمات** in the sidebar opens `/citizen#services` | Pass |
| Selecting a sidebar item closes the open mobile sidebar | Pass |
| Notification bell links to `/citizen/notifications` | Pass |
| Sidebar and citizen quick action both link to the notifications page | Pass |
| Notifications page loads the citizen's notification list | Pass |
| **تعليم الكل كمقروء** updates the view and clears unread state | Pass |
| Notifications page is guarded by the existing `CITIZEN` session gate | Pass |
| TypeScript build and whitespace validation | Pass |

## Visual verification

At a 390 × 844 mobile viewport, the notifications page displays a compact account header, a legible notification row, a clear back link to the citizen account, and the persistent mobile navigation. The layout does not require horizontal scrolling or overlap controls.

## Data and permissions

The page reads only the signed-in citizen's existing notifications through the established notification endpoints. It does not introduce synthetic notifications or change employee, reviewer, operations, or administrator permissions.
