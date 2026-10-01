# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).

Do not open public issues, discussions, or pull requests for security problems.

Include what you can of:

- the affected component (SvelteKit app, `api-v1` or another Edge Function, a migration/RLS policy);
- steps to reproduce or a proof of concept;
- the impact you observed, especially cross-organisation data access or privilege escalation.

We aim to acknowledge reports within a few working days and will keep you updated while a fix is prepared. Please give us reasonable time to release a fix before disclosing publicly.

## Supported versions

Only the latest commit on `main` receives security fixes.

## Scope notes for self-hosters

- Keep the Supabase service-role key server-side only; it belongs in Edge Function runtime env, never in the app's `PUBLIC_*` variables.
- Set `API_CORS_ORIGIN` to your app origin and give each cron worker its own random secret.
- Never enable the `*_STAGING_STUB` or `AI_COMPLETION_STUB` flags in production.
