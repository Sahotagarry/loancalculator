-- Contractual first installment that differs from the regular payment
-- (e.g. $2,450 first, then $1,980/month). Nullable: existing loans unchanged.
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "first_payment_amount" numeric(15, 2);
