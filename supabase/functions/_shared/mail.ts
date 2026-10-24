export type Email = { to: string; subject: string; text: string };

/** Sends the FR-B9 emails. */
export interface Mailer {
  send(email: Email): Promise<void>;
}

/** Resend's HTTP API (SYSTEM_DESIGN 5.2). */
export function createResendMailer(options: {
  apiKey: string;
  from: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}): Mailer {
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    async send(email) {
      const response = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: options.from, to: [email.to], subject: email.subject, text: email.text }),
      });
      if (!response.ok) throw new Error(`resend: HTTP ${response.status}`);
    },
  };
}

/** Used when `RESEND_API_KEY` is empty, as in local development: logs the subject line, never the address. */
export function createLogMailer(): Mailer {
  return {
    async send(email) {
      console.log(`email not sent (no RESEND_API_KEY): ${email.subject}`);
    },
  };
}

export class MemoryMailer implements Mailer {
  readonly sent: Email[] = [];
  failNext = false;
  async send(email: Email) {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("mail down");
    }
    this.sent.push(email);
  }
}
