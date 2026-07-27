import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow,
  TableCell, WidthType, BorderStyle, AlignmentType, ShadingType,
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
const codeBlock = (t) => new Paragraph({
  spacing: { after: 160 }, shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
  children: t.split("\n").flatMap((line, i, a) => i < a.length - 1
    ? [new TextRun({ text: line, font: "Consolas", size: 18 }), new TextRun({ break: 1 })]
    : [new TextRun({ text: line, font: "Consolas", size: 18 })]),
});

const cell = (t, opts = {}) => new TableCell({
  width: { size: opts.w ?? 3000, type: WidthType.DXA },
  shading: opts.head ? { type: ShadingType.CLEAR, fill: CHARCOAL } : undefined,
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  children: [new Paragraph({ children: [new TextRun({ text: t, bold: !!opts.head, color: opts.head ? "FFFFFF" : undefined, font: opts.mono ? "Consolas" : undefined, size: opts.mono ? 18 : 20 })] })],
});

const envTable = new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ children: [cell("Setting name", { head: true }), cell("Required?", { head: true }), cell("What it is / where to get it", { head: true, w: 5000 })] }),
    ...[
      ["DATABASE_URL", "Required", "PostgreSQL connection string from your Azure Database for PostgreSQL server. Format: postgresql://USER:PASSWORD@SERVER.postgres.database.azure.com:5432/DATABASE?sslmode=require"],
      ["ADMIN_PASSWORD", "Required", "A password you choose. Used to unlock the Settings page inside the app."],
      ["SESSION_SECRET", "Required", "A long random string you choose (e.g. 32+ characters). Used to encrypt the Azure keys saved through the in-app Settings page. Keep it stable: if it changes, any keys saved in the app must be re-entered on the Settings page."],
      ["NODE_ENV", "Required", "Set to: production  (this turns on serving the web app from the server)"],
      ["AZURE_OPENAI_ENDPOINT", "For AI import", "From your Azure OpenAI resource, Keys and Endpoint page. Example: https://YOURNAME.openai.azure.com"],
      ["AZURE_OPENAI_KEY", "For AI import", "Key 1 from the same page."],
      ["AZURE_OPENAI_DEPLOYMENT", "For AI import", "The name you gave your model deployment (e.g. gpt-5 or gpt-4.1)."],
      ["AZURE_DOC_INTEL_ENDPOINT", "For AI import", "From your Document Intelligence resource, Keys and Endpoint page."],
      ["AZURE_DOC_INTEL_KEY", "For AI import", "Key 1 from the same page."],
      ["AZURE_STORAGE_CONNECTION_STRING", "Recommended", "From your Storage Account, Access keys page. If omitted, uploaded PDFs are stored inside the database instead — this works, but Blob Storage is cheaper and better for large volumes."],
      ["WEBSITE_RUN_FROM_PACKAGE", "Recommended", "Set to: 1  (standard Azure App Service setting when deploying with GitHub Actions)"],
    ].map(([n, r, d]) => new TableRow({ children: [cell(n, { mono: true }), cell(r), cell(d, { w: 5000 })] })),
  ],
});

const doc = new Document({
  numbering: {
    config: ["steps1", "steps2", "steps3", "steps4", "steps5", "steps6", "steps7", "steps8"].map(ref => ({
      reference: ref,
      levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT }],
    })),
  },
  styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
  sections: [{
    children: [
      new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Loan & Lease Calculator", color: CHARCOAL })] }),
      new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: "Deployment Guide: GitHub + Azure App Service", size: 28, color: ORANGE, bold: true })] }),
      p("This guide walks you through publishing the application source code to GitHub and running the app on Microsoft Azure. No prior Azure experience is assumed. Expect the full setup to take roughly 1–2 hours the first time."),

      h1("1. What you are deploying"),
      p("The app is a single Node.js web application with these moving parts:"),
      bullet(b("Web app + API server"), " — one Node.js service. In production it serves both the user interface and the data API."),
      bullet(b("PostgreSQL database"), " — stores clients, year-end files, loans, and leases."),
      bullet(b("Azure Blob Storage"), " — stores uploaded PDF documents (optional; falls back to the database if not configured)."),
      bullet(b("Azure OpenAI + Azure Document Intelligence"), " — power the AI document import feature (reading loan/lease agreements from PDFs)."),
      bullet(b("Bank of Canada public API"), " — used automatically for prime-rate lookups; needs no setup or key."),

      h1("2. Prerequisites"),
      bullet("A GitHub account (free) — github.com"),
      bullet("An Azure subscription — portal.azure.com"),
      bullet("Optional, for working locally: Node.js 20+ and pnpm 10 installed on your computer."),

      h1("3. Put the code on GitHub"),
      p("You received the code as a zip file (clearline-loan-calculator-source.zip)."),
      numbered("steps1")("On GitHub, click ", b("New repository"), ". Name it (e.g. loan-calculator), set it to ", b("Private"), ", and do NOT initialize with a README."),
      numbered("steps1")("Unzip the source zip on your computer."),
      numbered("steps1")("In a terminal, inside the unzipped folder, run the commands below (replace YOURNAME/YOURREPO):"),
      codeBlock("git init\ngit add .\ngit commit -m \"Initial import\"\ngit branch -M main\ngit remote add origin https://github.com/YOURNAME/YOURREPO.git\ngit push -u origin main"),
      p(b("Tip: "), "If you are not comfortable with the terminal, GitHub Desktop (desktop.github.com) can do the same with clicks: Add Local Repository → Publish Repository."),

      h1("4. Create the Azure resources"),
      p("In the Azure Portal, create one Resource Group (e.g. rg-loan-calculator) and put everything below inside it. Pick the same region for all resources (e.g. Canada Central)."),

      h2("4.1 PostgreSQL database"),
      numbered("steps2")("Create ", b("Azure Database for PostgreSQL – Flexible Server"), "."),
      numbered("steps2")("Cheapest workable tier: Burstable B1ms. PostgreSQL version 16 or newer."),
      numbered("steps2")("Set an admin username and password — save these."),
      numbered("steps2")("Networking: allow public access and check ", b("\u201CAllow public access from any Azure service within Azure\u201D"), " so the App Service can connect."),
      numbered("steps2")("After it deploys, open the server → Databases → create a database named ", b("loancalc"), "."),
      numbered("steps2")("Your connection string will be: postgresql://ADMINUSER:PASSWORD@SERVERNAME.postgres.database.azure.com:5432/loancalc?sslmode=require"),

      h2("4.2 Storage account (for PDFs)"),
      numbered("steps3")("Create a ", b("Storage account"), " (Standard, LRS redundancy is fine)."),
      numbered("steps3")("After it deploys: Access keys → copy ", b("Connection string"), " (key1)."),
      p("You do not need to create a container manually — the app creates one automatically on first upload."),

      h2("4.3 Azure OpenAI (AI document import)"),
      numbered("steps4")("Create an ", b("Azure OpenAI"), " resource."),
      numbered("steps4")("Open it in Azure AI Foundry and create a ", b("model deployment"), " — choose a current GPT model (e.g. gpt-5 or gpt-4.1). Note the deployment name you choose."),
      numbered("steps4")("From Keys and Endpoint, copy the ", b("endpoint URL"), " and ", b("Key 1"), "."),
      p(b("Important: "), "the app is written for current-generation models. Use the newest GPT model available to you; do not deploy a retired GPT-4 base model."),

      h2("4.4 Document Intelligence (PDF reading / OCR)"),
      numbered("steps5")("Create a ", b("Document Intelligence"), " resource (under Azure AI services)."),
      numbered("steps5")("Pricing tier: the free tier (F0) works but only reads the first 2 pages per request — the app works around this by splitting PDFs, but the paid tier (S0) is more reliable for long agreements."),
      numbered("steps5")("Copy the ", b("endpoint"), " and ", b("Key 1"), "."),

      h2("4.5 App Service (the app itself)"),
      numbered("steps6")("Create a ", b("Web App"), ": Publish = Code, Runtime = Node 22 LTS (or Node 20 LTS), OS = Linux."),
      numbered("steps6")("Plan: Basic B1 is a good starting point (Free F1 works for testing but sleeps and is slow)."),
      numbered("steps6")("After it deploys: Configuration → General settings → set ", b("Startup Command"), " to:"),
      codeBlock("node --enable-source-maps dist/index.mjs"),

      h1("5. App settings (environment variables)"),
      p("In your Web App: ", b("Settings → Environment variables"), ". Add each of the following, then click Apply. The app reads these at startup."),
      envTable,
      new Paragraph({ spacing: { before: 160, after: 120 }, children: [new TextRun({ text: "Note: Azure sets PORT automatically for Node apps — you do not need to add it.", italics: true })] }),
      p(b("Alternative for AI keys: "), "the app also has a Settings page (unlocked with ADMIN_PASSWORD) where the Azure OpenAI / Document Intelligence keys can be entered from inside the app instead of as environment variables. Environment variables are the more standard approach for production."),

      h1("6. Set up automatic deployment from GitHub"),
      p("The easiest path is Azure's built-in Deployment Center, but this app needs a custom build (it is a pnpm monorepo and the web front end must be built into the server), so use a GitHub Actions workflow file instead:"),
      numbered("steps7")("In your Web App: ", b("Overview → Download publish profile"), ". Open the downloaded file in a text editor and copy its entire contents."),
      numbered("steps7")("In GitHub: your repo → Settings → Secrets and variables → Actions → ", b("New repository secret"), ". Name it AZURE_PUBLISH_PROFILE and paste the contents."),
      numbered("steps7")("In your repo, create the file ", b(".github/workflows/deploy.yml"), " with the contents below (replace YOUR-APP-NAME with your Web App's name), commit, and push. Every push to main will now build and deploy automatically."),
      codeBlock(`name: Deploy to Azure App Service

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build shared libraries
        run: pnpm run typecheck:libs

      - name: Build web front end
        run: pnpm --filter @workspace/loan-calculator run build

      - name: Build API server
        run: pnpm --filter @workspace/api-server run build

      - name: Assemble deployment package
        run: |
          mkdir -p deploy/dist/public
          cp -r artifacts/api-server/dist/. deploy/dist/
          cp -r artifacts/loan-calculator/dist/public/. deploy/dist/public/
          cat > deploy/package.json << 'EOF'
          {
            "name": "loan-calculator-server",
            "private": true,
            "type": "module",
            "scripts": { "start": "node --enable-source-maps dist/index.mjs" },
            "dependencies": { "@azure/storage-blob": "^12.33.0" }
          }
          EOF
          cd deploy && npm install --omit=dev

      - name: Deploy to Azure
        uses: azure/webapps-deploy@v3
        with:
          app-name: YOUR-APP-NAME
          publish-profile: \${{ secrets.AZURE_PUBLISH_PROFILE }}
          package: deploy`),
      p("What this does: installs dependencies, builds the web interface, builds the server, places the web files inside the server's ", code("dist/public"), " folder (which the server serves automatically when NODE_ENV=production), adds the one runtime library the server loads from disk (the Azure Blob Storage client), and pushes the result to Azure."),

      h1("7. Create the database tables"),
      p("The first time only, the database tables must be created. From the unzipped source folder on your computer (with Node.js and pnpm installed):"),
      codeBlock("pnpm install\nDATABASE_URL=\"postgresql://ADMINUSER:PASSWORD@SERVERNAME.postgres.database.azure.com:5432/loancalc?sslmode=require\" pnpm --filter @workspace/db run push"),
      p("Answer yes to the prompts. This reads the schema definitions in the code and creates all tables. Re-run the same command any time the schema changes in a future version."),
      p(b("Firewall note: "), "to run this from your own computer, temporarily add your computer's IP address in the PostgreSQL server's Networking → Firewall rules."),

      h1("8. Moving your existing data from Replit (optional)"),
      p("If you have data in the Replit version you want to keep, the standard PostgreSQL tools move it:"),
      codeBlock("pg_dump \"REPLIT_DATABASE_URL\" --no-owner --no-privileges > backup.sql\npsql \"AZURE_DATABASE_URL\" < backup.sql"),
      p("If you do this instead of step 7, you do not need to run the table-creation command — the backup includes the tables. Ask for help with this step if needed; the Replit database URL is available inside the Replit workspace."),

      h1("9. Verify everything works"),
      numbered("steps8")("Open https://YOUR-APP-NAME.azurewebsites.net — the client list should load."),
      numbered("steps8")("Health check: https://YOUR-APP-NAME.azurewebsites.net/api/healthz should show a small OK response."),
      numbered("steps8")("Create a test client and a loan — confirms the database connection."),
      numbered("steps8")("Import a PDF loan agreement — confirms Document Intelligence + Azure OpenAI + Blob Storage."),
      numbered("steps8")("Open a loan's fair value assessment — confirms the Bank of Canada prime-rate lookup (no setup needed; if the public API is unreachable the app falls back to a built-in rate)."),

      h1("10. Good to know"),
      bullet(b("Costs: "), "typical light usage ≈ App Service B1 + PostgreSQL B1ms + storage + pay-per-use AI. Roughly CAD $40–70/month depending on region and AI volume."),
      bullet(b("Custom domain & HTTPS: "), "App Service → Custom domains. Azure provides free managed certificates."),
      bullet(b("Backups: "), "enable automated backups on the PostgreSQL Flexible Server (Settings → Backups). 7 days is the default."),
      bullet(b("Logs: "), "App Service → Log stream shows live server logs (the app logs in structured JSON)."),
      bullet(b("Scaling: "), "everything is standard Node.js + PostgreSQL; scaling up is changing the App Service plan size."),
      bullet(b("What was intentionally left out of the zip: "), "Replit-only design-preview tooling (mockup sandbox). It is not part of the product."),
      bullet(b("AI settings inside the app: "), "the in-app Settings page (unlocked with ADMIN_PASSWORD) can override the AI keys at runtime — useful for rotating keys without redeploying."),
    ],
  }],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync("exports/Azure-Deployment-Guide.docx", buf);
console.log("Written exports/Azure-Deployment-Guide.docx", buf.length, "bytes");
