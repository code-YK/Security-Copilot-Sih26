/**
 * One-click demo inputs for the Investigate view. The first and last are the
 * backend's own test fixtures (backend/tests/fixtures/*.eml); the invoice is a
 * generated message whose PDF carries embedded JavaScript and a link
 * annotation, to exercise the attachment sandbox's PDF read end to end.
 */
export type Sample = { id: string; title: string; hint: string; tone: 'critical' | 'high' | 'safe'; text: string }

export const EMAIL_SAMPLES: Sample[] = [
  {
    "id": "paypal",
    "title": "Spoofed PayPal alert",
    "hint": "TOR exit · lookalike link · invoice.pdf.exe",
    "tone": "critical",
    "text": "Received: from mx.victim-corp.in (mx.victim-corp.in [10.0.0.5])\n\tby mailstore.victim-corp.in with LMTP id abc123; Mon, 22 Sep 2026 10:15:09 +0530\nReceived: from mail-relay.secure-paypa1.com (unknown [185.220.101.34])\n\tby mx.victim-corp.in (Postfix) with ESMTP id 4F1A2B3C; Mon, 22 Sep 2026 10:15:02 +0530\nReceived: from [192.168.1.20] (unknown [185.220.101.34])\n\tby mail-relay.secure-paypa1.com (Postfix) with ESMTPSA id 9988; Mon, 22 Sep 2026 10:20:40 +0530\nReturn-Path: <bounce@secure-paypa1.com>\nFrom: \"PayPal Security\" <service@paypal.com>\nReply-To: account-review@secure-paypa1.com\nTo: finance@victim-corp.in\nSubject: Urgent: your account has been limited\nDate: Mon, 22 Sep 2026 10:14:55 +0530\nMessage-ID: <20260922101455.1234@secure-paypa1.com>\nAuthentication-Results: mx.victim-corp.in; spf=fail smtp.mailfrom=secure-paypa1.com; dkim=none; dmarc=fail header.from=paypal.com\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=\"BOUNDARY1\"\n\n--BOUNDARY1\nContent-Type: text/html; charset=\"utf-8\"\nContent-Transfer-Encoding: quoted-printable\n\n<html><body><p>Dear customer,</p><p>We noticed unusual activity. Your account will be suspended within 24 hours unless you verify your identity.</p>\n<p><a href=3D\"http://paypal-account-verify.secure-paypa1.com/login?id=3D8812\">Verify now</a></p></body></html>\n\n--BOUNDARY1\nContent-Type: application/pdf; name=\"invoice.pdf.exe\"\nContent-Disposition: attachment; filename=\"invoice.pdf.exe\"\nContent-Transfer-Encoding: base64\n\nTVqQAAMAAAAEAAAA//8AALgAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAAA4fug4AtAnNIbgBTM0hVGhpcyBwcm9ncmFtIGNhbm5vdCBiZSBydW4gaW4gRE9TIG1vZGUuDQ0KJAAAAAAAAAA=\n\n--BOUNDARY1--\n"
  },
  {
    "id": "invoice",
    "title": "Invoice with a booby-trapped PDF",
    "hint": "Embedded JavaScript · hidden link inside the PDF",
    "tone": "high",
    "text": "From: PayPal Billing <billing@paypa1-secure-billing.com>\nTo: analyst@example.in\nSubject: Invoice #88213 - payment overdue\nReturn-Path: <bounce@paypa1-secure-billing.com>\nReceived: from mail.paypa1-secure-billing.com ([185.220.101.34]) by\n mx.example.in with ESMTP; Sat, 27 Sep 2026 10:00:00 +0000\nMIME-Version: 1.0\nContent-Type: multipart/mixed; boundary=\"===============7203798754757961637==\"\n\n--===============7203798754757961637==\nContent-Type: text/plain; charset=\"utf-8\"\nContent-Transfer-Encoding: quoted-printable\n\nDear customer, your account will be suspended. Open the attached invoice and =\nverify your details immediately.\n\n--===============7203798754757961637==\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\nContent-Disposition: attachment; filename=\"Invoice_88213.pdf\"\nMIME-Version: 1.0\n\nJVBERi0xLjMKJeLjz9MKMSAwIG9iago8PAovUHJvZHVjZXIgKHB5cGRmKQo+PgplbmRvYmoKMiAw\nIG9iago8PAovVHlwZSAvUGFnZXMKL0NvdW50IDEKL0tpZHMgWyA0IDAgUiBdCj4+CmVuZG9iagoz\nIDAgb2JqCjw8Ci9UeXBlIC9DYXRhbG9nCi9QYWdlcyAyIDAgUgovTmFtZXMgPDwKL0phdmFTY3Jp\ncHQgPDwKL05hbWVzIFsgKDU5MGZiMDMxXDA1NWVlNGRcMDU1NGIwMVwwNTU4OGQyXDA1NTU4MjAx\nZDkxZjEwMSkgNSAwIFIgXQo+Pgo+Pgo+PgplbmRvYmoKNCAwIG9iago8PAovVHlwZSAvUGFnZQov\nUmVzb3VyY2VzIDw8Cj4+Ci9NZWRpYUJveCBbIDAuMCAwLjAgNjEyIDc5MiBdCi9QYXJlbnQgMiAw\nIFIKL0Fubm90cyBbIDYgMCBSIF0KPj4KZW5kb2JqCjUgMCBvYmoKPDwKL1R5cGUgL0FjdGlvbgov\nTmV4dCBudWxsCi9TIC9KYXZhU2NyaXB0Ci9KUyAoYXBwXDA1NmFsZXJ0XDA1MFwwNDdZb3VyIGlu\ndm9pY2UgaXMgcmVhZHlcMDQ3XDA1MVwwNzMpCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9UeXBlIC9B\nbm5vdAovU3VidHlwZSAvTGluawovUmVjdCBbIDUwIDUwIDMwMCA4MCBdCi9Cb3JkZXIgWyAwIDAg\nMCBdCi9BIDw8Ci9TIC9VUkkKL1R5cGUgL0FjdGlvbgovVVJJIChodHRwXDA3MlwwNTdcMDU3cGF5\ncGExXDA1NXNlY3VyZVwwNTViaWxsaW5nXDA1NmNvbVwwNTd2ZXJpZnkpCj4+Ci9QIDQgMCBSCj4+\nCmVuZG9iagp4cmVmCjAgNwowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAK\nMDAwMDAwMDA1NCAwMDAwMCBuIAowMDAwMDAwMTEzIDAwMDAwIG4gCjAwMDAwMDAyNjEgMDAwMDAg\nbiAKMDAwMDAwMDM3MyAwMDAwMCBuIAowMDAwMDAwNDk0IDAwMDAwIG4gCnRyYWlsZXIKPDwKL1Np\nemUgNwovUm9vdCAzIDAgUgovSW5mbyAxIDAgUgo+PgpzdGFydHhyZWYKNjkyCiUlRU9GCg==\n\n--===============7203798754757961637==--\n"
  },
  {
    "id": "lunch",
    "title": "A friend asking about lunch",
    "hint": "Clean Gmail-to-Gmail message",
    "tone": "safe",
    "text": "Received: by 2002:a05:6a10:1234:b0:5a1:aaaa:bbbb with SMTP id x12csp123456pxb;\n        Mon, 22 Sep 2026 03:10:05 -0700 (PDT)\nReceived: from mail-sor-f41.google.com (mail-sor-f41.google.com. [209.85.220.41])\n        by mx.google.com with SMTPS id a1sor123456qkb.11.2026.09.22.03.10.04\n        for <friend@gmail.com>; Mon, 22 Sep 2026 03:10:04 -0700 (PDT)\nReturn-Path: <alice@gmail.com>\nFrom: Alice <alice@gmail.com>\nTo: friend@gmail.com\nSubject: Lunch tomorrow?\nDate: Mon, 22 Sep 2026 15:40:01 +0530\nMessage-ID: <CAF12345abcdef@mail.gmail.com>\nMIME-Version: 1.0\nContent-Type: text/plain; charset=\"UTF-8\"\n\nHey, are we still on for lunch tomorrow at 1? Let me know.\n- Alice\n"
  }
]

export const LINK_SAMPLES: { url: string; hint: string }[] = [
  { url: 'http://paypal-account-limited.com/verify', hint: 'Lookalike login page' },
  { url: 'https://www.wikipedia.org/', hint: 'Known-good site' },
]
