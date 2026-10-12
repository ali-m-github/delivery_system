This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Bulk waybill import from a folder

Instead of using the "Upload Waybill" button, waybill photos can be dropped into a
folder on the server and imported in bulk. It runs the exact same pipeline
(`lib/waybill-ocr.ts`) — QR decode first, OCR as fallback — and attaches each
image to the order whose ID the QR/OCR resolves to.

```bash
# Preview first — extracts and reports, but writes nothing:
npm run import-waybills -- /path/to/waybill-photos --dry-run

# Then run for real:
npm run import-waybills -- /path/to/waybill-photos
```

Options:

- `--dry-run` — extract and report only; no file is written and no order is updated.
- `--limit <n>` — process at most `n` files (handy for a first spot check).
- `--concurrency <n>` — files processed at once, 1–4 (default 2, matches the OCR worker pool).
- `--move` — after a successful attach, move the source image into `<folder>/processed/`.
- `--force` — re-process files already recorded in the state file.
- `--no-recursive` — only read the top-level directory.

A `<folder>/.waybill-import-state.json` file records what has been processed, so an
interrupted run resumes without re-OCRing images it already handled.

Note: the OCR.space fallback used for hard-to-read photos is capped at 180
requests/hour on the free tier. Beyond that, files that local OCR could not read
will fail until the window resets — the summary reports them as
`fallback_rate_limited`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
