/**
 * C7: Credit and billing.
 *
 * Several steps are only possible in the Vultr console (gift code, payment
 * method, charges note, billing page). They are printed first, every run, so
 * the answers can be written into the log. The API part reads GET /v2/account,
 * GET /v1/usage (needs VULTR_INFERENCE_API_KEY) and the subscription usage
 * from GET /v2/inference. Read-only: runs the same with or without --apply.
 */
import {
	arrayIn,
	bearer,
	isMain,
	parseFlags,
	req,
	runCheck,
	vultrApiUrl,
	type Checker,
	type Ctx,
	type Outcome,
	type RunFlags,
} from './lib.js';

const NAME = 'c7-billing';

const MANUAL_STEPS = [
	'MANUAL 1. Console > Billing: redeem the hackathon gift code. Write down whether it asked for a payment method.',
	'MANUAL 2. Console > Serverless > Inference: create the subscription. Copy the "charges note" text into the log.',
	'MANUAL 3. After C6 has run, open the Inference usage tab and the billing page. Does usage draw from the $200 promo credit?',
	'MANUAL 4. Which price applies: the flat $0.55 in / $2.75 out per 1M (product page), or the per-model catalog rates (API_REFERENCE 5.5)?',
	'MANUAL 5. Note the account balance before and after C6. A negative balance is credit remaining.',
];

export function run(flags: RunFlags): Promise<Outcome> {
	return runCheck(
		{
			name: NAME,
			title: 'C7 Credit and billing',
			required: ['VULTR_API_KEY'],
			intro: (c: Checker) => {
				c.info('Manual steps (console only, recorded here as the checklist):');
				for (const step of MANUAL_STEPS) c.info(`  ${step}`);
			},
			body: c7,
		},
		flags,
	);
}

async function c7(x: Ctx): Promise<void> {
	const c = x.c;
	const api = vultrApiUrl();
	const token = x.need('VULTR_API_KEY');
	const v = (method: string, path: string) => req(method, `${api}${path}`, { headers: bearer(token) });

	c.title('Account balance and charges (GET /v2/account)');
	const acct = await v('GET', '/account');
	c.assert(acct.status === 200, 'GET /account', acct);
	const a = acct.json?.account ?? {};
	c.info(
		`balance ${a.balance} (negative = credit remaining, promo included), pending_charges ${a.pending_charges}, last_payment ${a.last_payment_amount} on ${a.last_payment_date}`,
	);
	c.info('Record this balance now and again after C6: the difference is the C6 spend drawn from credit.');

	c.title('Inference usage (GET /v1/usage, needs VULTR_INFERENCE_API_KEY)');
	const inferenceKey = x.opt('VULTR_INFERENCE_API_KEY');
	if (inferenceKey) {
		const base = (x.opt('VULTR_INFERENCE_BASE_URL') ?? 'https://api.vultrinference.com/v1').replace(/\/+$/, '');
		const usage = await req('GET', `${base}/usage`, { headers: bearer(inferenceKey) });
		c.assert(
			usage.status === 200,
			'GET /v1/usage',
			usage,
			'the shape was not captured in API_REFERENCE 5.4: the raw line is the evidence',
		);
	} else {
		c.info('VULTR_INFERENCE_API_KEY not set: /v1/usage skipped');
	}

	c.title('Inference subscriptions and usage (GET /v2/inference, GET /v2/inference/{id}/usage)');
	const subs = await v('GET', '/inference');
	c.assert(subs.status === 200, 'GET /v2/inference', subs);
	const list = arrayIn(subs.json, 'subscriptions');
	c.info(`${list.length} subscription(s)`);
	for (const s of list) {
		const u = await v('GET', `/inference/${s.id}/usage`);
		c.assert(
			u.status === 200,
			`GET /v2/inference/${s.id}/usage`,
			u,
			'compare chat_by_model prices with the flat $0.55/$2.75 rate (API_REFERENCE 5.5)',
		);
	}

	c.title('Compare');
	c.info('Answer MANUAL 3 and MANUAL 4 from the console, using the raw usage lines above as the numbers to check.');
}

if (isMain(import.meta.url)) {
	const outcome = await run(parseFlags());
	process.exitCode = outcome.status === 'FAIL' ? 1 : 0;
}
