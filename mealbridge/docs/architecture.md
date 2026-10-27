# Architecture

The target architecture separates browser UI (`frontend`), authenticated REST APIs (`backend`), prediction/allocation (`ai-service`) and durable relational storage (PostgreSQL). The API owns authorization and transactions; the AI service returns recommendations and must not directly commit allocations. The API validates each recommendation against current inventory, recipient demand, expiry, vehicle capacity and delivery status in a database transaction.

The implemented local demo currently uses a dependency-free Node HTTP server and a serialized JSON-file store in `server/`. The React/TypeScript, PostgreSQL and Python directories are planned scaffolds and are not connected to the demo.
