interface Env {
  VERCEL_APP_URL: string;
  INBOUND_EMAIL_SECRET: string;
}

export default {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const raw = await new Response(message.raw).text();
    const response = await fetch(`${env.VERCEL_APP_URL}/api/webhooks/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.INBOUND_EMAIL_SECRET}`,
      },
      body: JSON.stringify({
        messageId: message.headers.get("message-id") || crypto.randomUUID(),
        to: message.to.toLowerCase(),
        from: message.from,
        subject: message.headers.get("subject") || "",
        textBody: raw.slice(0, 4000),
      }),
    });
    if (!response.ok) throw new Error(`Inbound webhook rejected: ${response.status}`);
  },
};
