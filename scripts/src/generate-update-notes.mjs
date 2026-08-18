import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, WidthType, AlignmentType, ShadingType,
} from "docx";
import fs from "fs";

const ORANGE = "FB7708";
const CHARCOAL = "262626";

const h1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [new TextRun({ text: t, color: CHARCOAL })] });
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun({ text: t, color: ORANGE })] });
const p = (...runs) => new Paragraph({ spacing: { after: 120 }, children: runs.map(r => typeof r === "string" ? new TextRun(r) : r) });
const b = (t) => new TextRun({ text: t, bold: true });
const code = (t) => new TextRun({ text: t, font: "Consolas", size: 20 });
const bullet = (...runs) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: runs.map(r => typeof r === "string" ? new TextRun(r) : r) });
const numbered = (ref) => (...runs) => new Paragraph({ numbering: { reference: ref, level: 0 }, spacing: { after: 80 }, children: runs.map(r => typeof r === "string" ? new TextRun(r) : r) });

const cell = (t, opts = {}) => new TableCell({
  width: { size: opts.w ?? 3000, type: WidthType.DXA },
  shading: opts.head ? { type: ShadingType.CLEAR, fill: CHARCOAL } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text: t, bold: !!opts.head, color: opts.head ? "FFFFFF" : undefined, font: opts.mono ? "Consolas" : undefined, size: opts.mono ? 18 : 20 })] })],
});

const doc = new Document({
  numbering: {
    config: [
      { reference: "deploy", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT }] },
    ],
  },
  sections: [{
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, spacing: { after: 80 }, children: [new TextRun({ text: "Clearline Loan Calculator — Update Notes", color: CHARCOAL })] }),
      p(new TextRun({ text: "Changes included in the source zip dated July 27, 2026", italics: true })),

      h1("Summary of changes"),
      p("Three changes since the previous deployment. All are contained in the new source zip — no code edits are needed on your side."),
      bullet(b("1. Microsoft 365 sign-out. "), "A Sign out button in the app header ends the App Service Authentication (Easy Auth) session."),
      bullet(b("2. Signed-in user display. "), "The header shows the name of the signed-in Microsoft 365 user."),
      bullet(b("3. Encryption of Azure API keys at rest. "), "Keys saved through the in-app Settings page are now stored encrypted (AES-256-GCM) in the app_settings table instead of plain text."),

      h1("Change details"),

      h2("1 + 2 — Microsoft 365 sign-out and user name"),
      p("The front end calls ", code("GET /.auth/me"), " (the standard endpoint exposed by App Service Authentication). When it returns a signed-in principal, the header shows the user's display name plus a sign-out button that navigates to:"),
      p(code("/.auth/logout?post_logout_redirect_uri=/")),
      bullet("No app registration or App Service configuration changes are required."),
      bullet("In environments without Easy Auth (local dev, or auth disabled) the endpoint 404s and the button/name simply do not render."),
      bullet(b("Optional: "), "by default this ends only the app's session. If you also want to sign the user out of their Microsoft account in the browser, enable logging out from the identity provider in the App Service Authentication settings (Authentication > your Microsoft provider > sign-out behavior). This is a portal setting, not a code change."),

      h2("3 — Encryption of Azure API keys at rest"),
      p("Values written via the in-app Settings page (Document Intelligence, Azure OpenAI, Blob Storage credentials) are now stored in the database as:"),
      p(code("enc:v1:<iv>:<auth tag>:<ciphertext>   (AES-256-GCM)")),
      p("The encryption key is derived (scrypt) from the ", code("SESSION_SECRET"), " environment variable. Behavior:"),
      bullet(b("Automatic migration: "), "existing plain-text rows in app_settings are re-encrypted automatically the first time the server reads them after this deployment. Nothing to run manually."),
      bullet(b("Fail closed: "), "if SESSION_SECRET is not set, the app refuses to save settings (HTTP 503 with a clear message) rather than storing them unencrypted."),
      bullet(b("Environment-variable fallback unchanged: "), "keys supplied as App Service settings (AZURE_OPENAI_KEY etc.) still work exactly as before and are unaffected by this change."),

      h1("Action required"),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ children: [cell("Setting name", { head: true }), cell("Required?", { head: true }), cell("Notes", { head: true, w: 5000 })] }),
          new TableRow({ children: [cell("SESSION_SECRET", { mono: true }), cell("Required (new)"), cell("A long random string (32+ characters), set as an App Service configuration setting. Generate once, e.g. with: openssl rand -base64 48", { w: 5000 })] }),
        ],
      }),
      p(""),
      p(b("Important: keep SESSION_SECRET stable. "), "If it is ever changed or lost, keys previously saved through the Settings page become unreadable. The app does not break — the affected features report the keys as missing — but the keys must then be re-entered on the Settings page. Treat SESSION_SECRET like a password: store it in your password manager, and do not rotate it casually."),

      h1("Deployment steps"),
      numbered("deploy")("Add the SESSION_SECRET setting to the App Service (Configuration > Application settings), before or together with the deploy."),
      numbered("deploy")("Replace the repository contents with the new source zip and push — the existing GitHub Actions workflow deploys it as usual."),
      numbered("deploy")("No database migration is needed; the schema is unchanged."),
      numbered("deploy")("Verify: sign in, confirm your name appears in the header, click sign out, and confirm you are prompted to sign in again."),
      numbered("deploy")("Verify encryption: after the app has been used once, values in the app_settings table should begin with enc:v1: — e.g. run: SELECT key, left(value, 10) FROM app_settings;"),

      h1("Rollback"),
      p("If you redeploy a previous version after the app has migrated the keys: the old version cannot read encrypted values, so the Settings-page keys will appear unset (keys supplied as environment variables keep working). Re-entering them on the Settings page restores functionality. No data outside app_settings is touched by this update."),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync("exports/Update-Notes-July-2026.docx", buf);
console.log("Written exports/Update-Notes-July-2026.docx", buf.length, "bytes");
