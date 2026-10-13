export interface SendWhatsAppParams {
  to: string; // Recipient phone number (e.g. +96170123456 or 03123456)
  message: string;
}

export function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) cleaned = cleaned.substring(1);

  // Default Lebanon (961) local formatting if applicable
  if (cleaned.startsWith('0')) {
    cleaned = '961' + cleaned.substring(1);
  } else if (!cleaned.startsWith('961') && (cleaned.length === 7 || cleaned.length === 8)) {
    cleaned = '961' + cleaned;
  }
  return cleaned;
}

export async function sendWhatsAppMessage({ to, message }: SendWhatsAppParams): Promise<{ success: boolean; mock: boolean; error?: string }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const normalizedPhone = normalizePhoneNumber(to);

  // Development / Mock mode if API credentials are not yet configured
  if (!token || !phoneNumberId) {
    console.log('\n=================== [WHATSAPP MOCK LOG] ===================');
    console.log(`[To]: +${normalizedPhone}`);
    console.log(`[Message]:\n${message}`);
    console.log('===========================================================\n');
    return { success: true, mock: true };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: normalizedPhone,
        type: 'text',
        text: { preview_url: true, body: message },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[WhatsApp API Error]:', data);
      return { success: false, mock: false, error: data?.error?.message || 'Meta API Error' };
    }

    return { success: true, mock: false };
  } catch (err: any) {
    console.error('[WhatsApp Network Error]:', err);
    return { success: false, mock: false, error: err.message };
  }
}
