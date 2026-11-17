# How your ENV creates an M-Pesa STK prompt

This describes the current POS code. Secret values from `.env.local` are not copied into this file.

## 1. Your settings

| ENV variable | How the POS uses it |
| --- | --- |
| `MPESA_ENV=sandbox` | Selects `https://sandbox.safaricom.co.ke`. |
| `MPESA_CONSUMER_KEY` | Combined with the consumer secret to request an OAuth token. |
| `MPESA_CONSUMER_SECRET` | The other half of the OAuth credentials. |
| `MPESA_SHORTCODE` | Used as `BusinessShortCode`, `PartyB`, and part of the STK password. |
| `MPESA_PASSKEY` | Combined with the shortcode and timestamp to create the STK password. |
| `MPESA_CALLBACK_URL` | Public HTTPS address where Safaricom sends the STK result: your Ngrok host followed by `/api/mpesa/callback`. |
| `MPESA_CALLBACK_SECRET` | Your application's private secret for signing callback URLs. Must contain at least 32 characters. This is separate from the Safaricom consumer secret and passkey. |

**Current local check:** the consumer key, consumer secret, shortcode, passkey and callback URL are present. `MPESA_CALLBACK_SECRET` is missing. The current STK code checks this before starting payment, so it must be configured before an STK request can start.

```dotenv
MPESA_CALLBACK_SECRET=<your-own-random-private-value-at-least-32-characters>
```

The customer's phone number and payment amount do **not** come from ENV. The phone comes from checkout; the amount must match the server-priced cart saved in Supabase.

## 2. Get an OAuth access token

The server builds this header from the loaded credentials:

```text
Authorization: Basic Base64(MPESA_CONSUMER_KEY + ":" + MPESA_CONSUMER_SECRET)
```

It sends a GET request to:

```text
https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials
```

Safaricom returns an `access_token`. The STK request uses that token as:

```text
Authorization: Bearer <access_token>
```

The full Basic header and access token are credentials; keep their actual values out of this document and logs.

## 3. Create the timestamp and STK password

The timestamp comes from the server's **current date/time**, formatted in **Africa/Nairobi** time. It is not read from ENV.

```text
Format:    YYYYMMDDHHmmss
Example:   20261117123456  = 17 November 2026, 12:34:56 EAT

Password = Base64(MPESA_SHORTCODE + MPESA_PASSKEY + Timestamp)
```

There are **no separators** between the shortcode, passkey and timestamp. The same timestamp is included in the request body.

This generated `Password` is not the customer's M-Pesa PIN. The customer enters their PIN on the phone.

## 4. Send the STK request

The POS sends a POST request to:

```text
https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest
```

Illustrative body, with placeholders instead of your credentials and phone number:

```json
{
  "BusinessShortCode": "<MPESA_SHORTCODE>",
  "Password": "<Base64(shortcode + passkey + timestamp)>",
  "Timestamp": "20261117123456",
  "TransactionType": "CustomerPayBillOnline",
  "Amount": 1000,
  "PartyA": "<customer number normalized to 254...>",
  "PartyB": "<MPESA_SHORTCODE>",
  "PhoneNumber": "<same normalized customer number>",
  "CallBackURL": "https://YOUR-NGROK-HOST/api/mpesa/callback?id=<attemptId>&token=<signature>",
  "AccountReference": "<first 12 characters of saleId>",
  "TransactionDesc": "Pedigree POS"
}
```

`TransactionType` above is the value currently used by the code. The callback signature is `HMAC-SHA256(MPESA_CALLBACK_SECRET, attemptId)`; it lets the POS check that the callback URL belongs to its payment attempt.

If Safaricom accepts the request, it returns merchant/checkout request IDs and starts the phone prompt. Acceptance alone does not mean the customer paid. The POS validates the callback and queries Daraja before recording a paid sale and changing stock.

## 5. Where to follow this in the project

- `lib/mpesa/client.ts`: ENV configuration, OAuth, Nairobi timestamp, STK password and outgoing request.
- `app/api/mpesa/stk-push/route.ts`: staff authorization, payment attempt and STK initiation.
- `app/api/mpesa/callback/route.ts`: callback validation.
- `lib/mpesa/service.ts`: independent status verification and sale finalization.

**Important distinction:** `pnpm mpesa:register-urls` registers the C2B notification URLs for manual Till payments. It does **not** create an STK prompt. To request a prompt, use **POS → Charge → M-Pesa → Initiate Payment**.
