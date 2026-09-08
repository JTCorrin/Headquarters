#!/usr/bin/env node
// Run once per hosted Supabase project. Credentials stay in the environment/Vault.
import { randomBytes } from 'node:crypto';

const project = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!project || !/^[a-z]{20}$/.test(project) || !token) {
	throw new Error(
		'Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN before configuring the scheduler.'
	);
}
const base = `https://api.supabase.com/v1/projects/${project}`;
async function api(path, body) {
	const response = await fetch(base + path, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!response.ok)
		throw new Error(`Supabase ${path} failed (${response.status}). No credentials are logged.`);
	const text = await response.text();
	return text ? JSON.parse(text) : null;
}

// Reuse the scheduler's existing Vault secret so re-running does not disrupt a live worker.
const rows = await api('/database/query', {
	query:
		"select decrypted_secret from vault.decrypted_secrets where name='headquarters_campaigns_cron_secret'"
});
const secret = rows[0]?.decrypted_secret || randomBytes(32).toString('hex');
await api('/secrets', [{ name: 'CAMPAIGNS_CRON_SECRET', value: secret }]);
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
const result = await api('/database/query', {
	query: `
    do $setup$ begin
      if not exists(select 1 from vault.secrets where name='headquarters_campaigns_cron_secret') then
        perform vault.create_secret(${literal(secret)},'headquarters_campaigns_cron_secret');
      end if;
    end $setup$;
    select cron.schedule('campaigns-every-minute','* * * * *',$job$
      select net.http_post(
        url := 'https://${project}.supabase.co/functions/v1/jobs-campaigns',
        headers := jsonb_build_object('Content-Type','application/json','x-campaigns-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name='headquarters_campaigns_cron_secret')),
        body := '{}'::jsonb, timeout_milliseconds := 120000
      );
    $job$);
    select jobname,schedule,active from cron.job where jobname='campaigns-every-minute';`
});
console.log('Campaign scheduler configured:', result);
