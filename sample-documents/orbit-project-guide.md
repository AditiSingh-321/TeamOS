# Orbit Team Portal - Sample Project Guide

This is a fictional project document for testing TeamOS document search and citations. The people, dates, and decisions below are sample data, not information about your real team.

## Project purpose

Orbit Team Portal is an internal website for a small product team. Its purpose is to keep project updates, shared documents, and delivery responsibilities in one place. The pilot will support 12 team members.

The first release must include email login, a project overview, a shared document library, and a searchable help page. Mobile users must be able to read updates and open documents.

## Authentication decision

The team selected Supabase Authentication with email and password login. Users must confirm their email address before accessing the portal.

Supabase manages authentication sessions using access tokens and refresh tokens. Protected pages must verify the authenticated user on the server. Workspace membership must be checked before returning private project data.

Google sign-in is optional and will remain disabled for the pilot until its OAuth configuration is approved.

## Technology and database decisions

The frontend uses Next.js App Router, React, TypeScript, and Tailwind CSS. Supabase PostgreSQL is the primary database. Private uploaded files are stored in Supabase Storage.

Row Level Security policies must restrict project records to authorized workspace members. The browser must never receive a Supabase service-role key.

Sarvam AI generates answers to document questions. The pilot uses PostgreSQL keyword search to retrieve relevant passages before generating an answer. Answers must cite the retrieved source document. If the documents do not support an answer, the assistant must say that there is not enough information.

## Document library requirements

The library accepts selectable-text PDF, DOCX, UTF-8 TXT, and Markdown files. Each file must be no larger than 3 MiB. Scanned PDFs requiring OCR are outside the pilot scope.

The document list must display the filename, upload date, uploader, and processing status. Processing statuses are Pending, Processing, Ready, and Failed. Users should wait until a document is Ready before asking questions about it.

Deleting a document must immediately remove its content from search. If private file cleanup fails, the system must queue a retry.

## Deployment process

The web application will be hosted on Vercel. The document processing worker will run as a separate supervised Node.js process. Deploying the web application alone will not start the worker.

Before each release, the team must run linting, TypeScript checks, automated tests, and a production build. Database migrations must be reviewed and applied before enabling features that depend on them.

Secrets are supplied through environment variables. Production credentials must not be committed to GitHub.

## Team responsibilities

Maya is the project owner and approves scope changes. Ravi owns frontend implementation and deployment preparation. Isha owns testing, accessibility checks, and release verification.

The pilot target date is December 18, 2026. This is a fictional planning date for this sample document.

## Acceptance criteria

The pilot is ready when a verified user can log in, open an authorized project, upload a supported document, wait for Ready, and receive an answer with a citation to that document.

An account outside the workspace must not be able to read the project's records or download its private files. After a document is deleted, new answers must not cite it.

## Decisions not recorded

This document does not specify a monthly budget, a customer pricing plan, or an office location. Questions about those topics should receive an insufficient-information answer.
