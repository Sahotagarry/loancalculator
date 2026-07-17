import { LoanCalculator } from "@/components/loan-calculator";
import logo from "@assets/logo-small-1_1772652659111.png";

export default function Home() {
  return (
    <div className="min-h-screen bg-background p-4 md:p-8 selection:bg-primary/20">
      <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="space-y-6 pb-6 border-b border-border/40">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent bg-secondary text-secondary-foreground">
                Financial Tool
              </div>
              <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground font-display">
                Clearline Loan Amortization Calculator
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Professional calculator for loan payments, interest breakdown, and ASPE financial statement disclosures.
              </p>
            </div>
            <div className="flex-shrink-0">
              <img 
                src={logo} 
                alt="Clearline Logo" 
                className="h-16 w-auto object-contain brightness-0 dark:brightness-100 invert-0 dark:invert"
              />
            </div>
          </div>
        </header>

        <main>
          <LoanCalculator />
        </main>
      </div>
    </div>
  );
}