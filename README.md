# POS Web App

A demo point-of-sale web app for Adyen IPP. It drives a physical
terminal over the Terminal API (cloud) and an Android phone over Tap to Pay, and
shows every request and response it makes so the integration can be inspected
while it runs.

## What it does

- **Take a card payment on a terminal.** Pick products, press Pay Now, choose a
  payment method (Card, DuitNow POS, PayNow POS, or a card number keyed on the
  terminal). Works in synchronous or asynchronous mode.
- **Take a payment with Tap to Pay on Android.** Boards the Adyen Payments app on
  the device and hands the payment to it, no terminal hardware involved.
- **Manage orders.** Search by PSP / ServiceID, open an order
  for the full record, refund in full or in part, reprint a receipt, and check or
  cancel a payment that is still running.
- **Print a customised receipt.** Upload a logo and set the QR code that goes at
  the bottom.
- **Redeem loyalty points.** Read a card on the terminal to identify a member,
  then pay the discounted amount.
- **Read the API log.** Every Terminal API and Management API call, request and
  response, as it happens.

It installs as a PWA.

## The settings panel

**Current Terminal** — a picker showing the active terminal with its model and
serial. Open it to switch between the terminals this till knows about, or use the
✕ to remove one. Payments and every order action go to the active terminal. Once
a status check has run, an **Online** or **Offline** pill appears beside the
model; before that nothing is assumed.

| Button | What it does |
| --- | --- |
| **Check status** | Asks Adyen which terminals are online for this merchant account, and marks the list accordingly. Also used to notice a terminal has dropped off. |
| **Add terminal** | Adds every terminal that is online for this merchant account and not already listed — nothing to type, since the merchant account decides what exists. Up to 5, held in memory only; seed `ADYEN_TERMINAL_POIID` to keep them across a restart. |
| **Tap to Pay** | Board this Android device against the Adyen Payments app, pay with it, or revoke the instance. Android only, and the Payments app has to be installed. |
| **API log** | Shows or hides the raw request/response panel. |
| **Receipt** | Receipt logo and the QR code printed at the bottom. Both persist on the server. |
| **Loyalty** | Read a card to match a member, see the points discount applied to the basket, then pay. Members are managed from the dialog's **User management** button. |

**Sync / Async** — how a payment is reported.

- *Sync* holds the HTTP request open until the terminal returns a
  `PaymentResponse`. The result comes back on the same call.
- *Async* returns as soon as the terminal accepts the payment; the outcome
  arrives later by webhook. A **Transaction Status** box appears in the panel and
  fills with the terminal's display notifications as the cardholder proceeds.

Both modes update the order list live over SSE, so a result never depends on the
page being refreshed.

## Running it locally

```bash
npm install
cp .env.example .env      # then fill in the required values
npm run certs             # self-signed pair for local HTTPS
npm start
```

Then open <https://localhost:3000> and log in with `ACCESS_CODE`.

### What works locally, and what does not

**Azure is only about where orders are stored.** Locally they go to
`assets/orders.json`, created on first write, and nothing else depends on Azure.
Do set `AZURE_STORAGE_CONNECTION_STRING` on a real deployment though: that file
sits in the application directory, which every redeploy replaces, and orders carry
the PSP and tender references payments are reconciled by.

What does not work is anything that needs Adyen or a phone to reach *your*
machine, which `localhost` never is:

| | Locally |
| --- | --- |
| **Async payment results** | Do not arrive on their own — Adyen cannot reach `/api/webhook`. Still obtainable: **Check Status** polls the terminal over the cloud, and pending orders are re-checked at startup. Async stays usable, it just stops being hands-off. |
| **Transaction Status box** | Stays empty. It is filled by display notifications the terminal POSTs to `/api/display`. |
| **Tap to Pay** | Not testable. The return URL is derived from the address you are browsing, so `localhost` cannot be returned to from the phone — and a LAN address will not match the certificate `npm run certs` issues for `localhost`. |

Everything else is a call this app makes outwards, so it needs nothing extra: sync
card payments, refunds, receipt reprints, card reads and loyalty, terminal status
checks, Add terminal, and the API log.

For the full set locally, put the app behind a public HTTPS hostname (ngrok,
Cloudflare Tunnel) and use that one hostname in three places: Adyen's webhook
URL, the terminal's Display Notification URL, and your browser.
