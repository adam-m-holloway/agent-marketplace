export type Channel = "email" | "sms" | "push";

export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  retryable?: boolean;
}

export function parseWebhook(body: string): any {
  return JSON.parse(body);
}

export function channelFor(payload: any) {
  if (payload.phone) return "sms";
  if (payload.deviceToken) return "push";
  return "email";
}

export async function send(payload: any, transport: any) {
  try {
    const id = await transport.deliver(channelFor(payload), payload);
    return { success: true, messageId: id };
  } catch (err: any) {
    return { success: false, error: err.message, retryable: err.status >= 500 };
  }
}

export function firstRecipient(list: string[]) {
  return list[0]!.toLowerCase();
}
