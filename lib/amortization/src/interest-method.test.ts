import { describe, expect, it } from 'vitest';
import { accrualYears, calculateAmortization, type AmortizationOptions } from './index';
const d = (s: string) => new Date(`${s}T00:00:00`);
const loan = (method: AmortizationOptions['interestMethod'], extras: AmortizationOptions = {}) => calculateAmortization(100000, 6, 2, 1, d('2027-04-01'), 0, [], 0, 'monthly', 5000, 0, 'none', { interestMethod: method, firstPaymentDate: d('2027-05-01'), ...extras });

describe('contractual interest methods', () => {
  it('preserves the full legacy schedule when equal periods is selected', () => {
    expect(loan('periodic')).toEqual(loan(undefined)); expect(loan(null)).toEqual(loan(undefined));
    expect(loan('periodic').schedule[0].interest).toBe(500);
  });
  it('uses 30 then 31 days, charging the reduced balance in month two', () => {
    const [a,b] = loan('actual_365').schedule;
    expect(a.interest).toBeCloseTo(100000*.06*30/365,10);
    expect(b.interest).toBeCloseTo((100000+a.interest-5000)*.06*31/365,10);
  });
  it('counts leap days and divides cross-year intervals in their respective calendar years', () => {
    expect(accrualYears(d('2028-02-01'),d('2028-03-01'),'actual_year')).toBeCloseTo(29/366,12);
    expect(accrualYears(d('2027-12-15'),d('2028-01-15'),'actual_year')).toBeCloseTo(17/365+14/366,12);
    expect(accrualYears(d('2028-02-01'),d('2028-03-01'),'actual_365')).toBeCloseTo(29/365,12);
  });
  it('uses the equivalent regular rate for a nominal semi-annual quote', () => {
    expect(loan('semi_annual').schedule[0].interest).toBeCloseTo(100000*(1.03**(1/6)-1),9);
  });
  it('uses funding to first due for a stub and zero days for a same-day advance payment', () => {
    expect(loan('actual_365',{firstPaymentDate:d('2027-04-13')}).schedule[0].interest).toBeCloseTo(100000*.06*12/365,9);
    const [a,b] = loan('actual_365',{firstPaymentDate:d('2027-04-01'),paymentTiming:'beginning'}).schedule;
    expect(a.interest).toBe(0);expect(b.interest).toBeCloseTo(95000*.06*30/365,9);
  });
  it('recasts from the accrued amount and actual remaining dates on a part-period principal payment', () => {
    const base=loan('actual_365'); const r=loan('actual_365',{principalEvents:[{id:'p',amount:3000,effectiveDate:d('2027-04-11'),sequence:1,ordering:'before_scheduled_payment',treatment:'keep_maturity'}]});
    const first=r.schedule.find(row=>row.rowType==='scheduled_payment')!;
    expect(first.interest).toBeCloseTo((100000*10+97000*20)*.06/365,9);
    expect(r.schedule.at(-1)!.balance).toBeCloseTo(base.schedule.at(-1)!.balance,6);
  });
  it('splits interest at a rate reset and never charges monthly interest on a same-day interval', () => {
    const r=loan('actual_365',{rateResetEvents:[{id:'r',benchmarkRate:5,spread:3,resultingContractualRate:8,effectiveDate:d('2027-04-11'),sequence:1,ordering:'before_scheduled_payment',sourceEvidence:{source:'agreement'},treatment:'keep_payment'}]});
    expect(r.schedule[0].interest).toBeCloseTo(100000*(.06*10+.08*20)/365,9);
  });
  it.each(['weekly','bi-weekly','monthly','semi-monthly'] as const)('amortizes to the balloon without a catch-up on %s dates',frequency=>{
    const r=calculateAmortization(100000,7,1,1,d('2028-01-03'),0,[],10000,frequency,null,0,'none',{interestMethod:'actual_year',semiMonthlyDueDays:frequency==='semi-monthly'?[1,15]:undefined});
    expect(r.schedule.at(-1)!.balance).toBeCloseTo(10000,8); expect(r.schedule.at(-1)!.payment).toBeCloseTo(r.monthlyPayment,7);
  });
  it('capitalizes actual grace interest and uses the distinct first payment exactly once',()=>{
    const r=calculateAmortization(100000,6,1,1,d('2028-01-01'),0,[],0,'monthly',null,1,'capitalized',{interestMethod:'actual_365',graceTermMode:'added',firstPaymentDate:d('2028-03-01'),firstPaymentAmount:8000});
    const [grace,first]=r.schedule;
    expect(grace.payment).toBe(0); expect(grace.interest).toBeCloseTo(100000*.06*31/365,9);
    expect(first.payment).toBe(8000); expect(first.interest).toBeCloseTo(grace.balance*.06*29/365,9);
    expect(r.schedule.at(-1)!.balance).toBeCloseTo(0,7);
  });
});
