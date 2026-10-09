# Decisions log (overnight run, M1–M4)

Decisions the brief did not cover, made without being able to ask. Each entry: what,
why, alternatives, how to reverse. Newest entries are appended at the end of each
milestone section.

## General

### D-001 docker-compose Postgres on port 54329, not 5432

- **What:** `docker-compose.yml` maps Postgres to host port 54329.
- **Why:** a local PostgreSQL 18 service already listens on 5432 on this machine.
- **Alternatives:** stop the local service; use the local install instead of Docker.
- **Reverse:** change the port in `docker-compose.yml` and the `DATABASE_URL`s in `.env.example` / test configs.
