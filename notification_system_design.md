# Campus Notifications Microservice

## Stage 1 — REST API Design

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/notifications` | Fetch all notifications for the current user |
| `GET` | `/notifications/:id` | Fetch one notification |
| `PATCH` | `/notifications/:id/read` | Mark one notification as read |
| `PATCH` | `/notifications/read-all` | Mark all notifications as read |
| `POST` | `/notifications` | Create a notification |
| `POST` | `/notifications/broadcast` | Broadcast a notification to all students |
| `GET` | `/notifications/unread-count` | Fetch the unread count |

Example response for `GET /notifications`:

```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "string",
      "timestamp": "2026-05-16T12:00:00.000Z",
      "isRead": false
    }
  ],
  "total": 42,
  "unread": 7
}
```

All requests require:

```text
Authorization: Bearer <token>
Content-Type: application/json
```

For real-time delivery, use a WebSocket channel per student such as `/ws/notifications/<studentID>`. When a notification is inserted, publish a `notification_created` event to the relevant socket. Server-Sent Events are a reasonable fallback when only one-way streaming is needed.

## Stage 2 — Database Schema

PostgreSQL is a good fit because the data is structured, strongly related, and query patterns are predictable.

```sql
CREATE TABLE students (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  email      VARCHAR(255) UNIQUE NOT NULL,
  roll_no    VARCHAR(50) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  notification_type VARCHAR(20) NOT NULL CHECK (
    notification_type IN ('Placement', 'Event', 'Result')
  ),
  message           TEXT NOT NULL,
  is_read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Fetch unread notifications:

```sql
SELECT id, notification_type, message, created_at
FROM notifications
WHERE student_id = $1
  AND is_read = FALSE
ORDER BY created_at DESC;
```

Mark all notifications as read:

```sql
UPDATE notifications
SET is_read = TRUE
WHERE student_id = $1
  AND is_read = FALSE;
```

At large scale, the main risks are unbounded table growth, slow scans without indexes, and write pressure during broadcasts. Partitioning by `created_at`, archiving old records, and buffering large fan-out work through a queue keep the system healthy as volume rises.
