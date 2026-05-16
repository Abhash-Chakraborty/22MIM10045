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

## Stage 3 — Query Optimization

Given the slow query:

```sql
SELECT *
FROM notifications
WHERE studentID = 1042
  AND isRead = FALSE
ORDER BY createdAt DESC;
```

The query is inefficient because it reads unnecessary columns, filters using columns that are not indexed together, and must sort a large result set after scanning many rows.

Use normalized column names, fetch only the needed fields, and add a partial composite index for the hot unread path:

```sql
CREATE INDEX idx_notifications_student_unread
ON notifications (student_id, created_at DESC)
WHERE is_read = FALSE;
```

Then query:

```sql
SELECT id, notification_type, message, created_at
FROM notifications
WHERE student_id = $1
  AND is_read = FALSE
ORDER BY created_at DESC;
```

Indexing every column is not a safe shortcut. Each index consumes space and slows inserts, updates, and deletes because it must be maintained on every write.

For recent placement alerts:

```sql
SELECT id, message, created_at
FROM notifications
WHERE student_id = $1
  AND notification_type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

Supporting index:

```sql
CREATE INDEX idx_notifications_type_date
ON notifications (student_id, notification_type, created_at DESC);
```

## Stage 4 — Caching Strategy

Use Redis as a read cache for per-student notification feeds:

```text
Request → Redis hit? → return cached response
                ↓ miss
          query PostgreSQL
                ↓
        cache result for 60s
                ↓
          return response
```

Recommended policy:

- cache key: `notifs:unread:<studentID>`
- TTL: 60 seconds
- invalidate immediately when a notification is inserted or read state changes

This balances fast reads with bounded staleness. A plain TTL cache is simple but can briefly serve old data; write-through invalidation keeps user-visible state fresh after interactions. CDN caching is a poor fit for private per-user data, while read replicas reduce DB load without removing the application-level hot path.

## Stage 5 — Bulk Notification Reliability

The naive design is fragile:

```python
function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)
```

Problems:

- one transient email failure can stop the whole loop,
- work is serialized for every student,
- there is no retry policy,
- persistence and delivery are coupled even though they have different failure modes.

The database write should be the source of truth and should happen before side effects. Persist the notification fan-out in one transaction, enqueue delivery jobs, and let workers process email and push delivery independently with retries.

```text
Request received
      ↓
Bulk insert notifications in one transaction
      ↓
Enqueue delivery jobs
      ↓
Return 202 Accepted
      ↓
Workers send email/push with retry + backoff
```

Illustrative pseudocode:

```ts
async function notifyAll(studentIds: string[], message: string) {
  await db.bulkInsert(
    studentIds.map((studentId) => ({
      studentId,
      message,
      type: "Placement",
    }))
  );

  const jobs = studentIds.map((studentId) => ({ studentId, message }));
  await queue.addBulk("send-email", jobs, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
  });
  await queue.addBulk("push-notification", jobs, { attempts: 2 });
}
```

If delivery fails for one student, the durable notification record already exists and the failed job can be retried without blocking everyone else.

## Stage 6 — Priority Inbox

The working implementation lives in `notification_app_be/priorityInbox.ts`. It fetches notifications, combines type priority with a recency score, and keeps only the top `N` items using a min-heap so the selection cost remains `O(n log k)`.
