# Database schema

The target relational schema is represented by `backend/prisma/schema.prisma` and `database/init.sql`; migrations and seed implementation remain to be added. The tested demo uses `server/store.js` and JSON data, not PostgreSQL.

Target entities: User, Organization, Verification, Donation, RecipientDemand, Allocation, DeliveryPartner, Vehicle, Delivery, DeliveryStatusHistory, Prediction, Notification and AuditLog. Store bounded quantities and timezone-aware timestamps, and enforce unique email, nonnegative inventory, valid state transitions and allocation foreign keys. Allocation and cancellation must be transactional.
