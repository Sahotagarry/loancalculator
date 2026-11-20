import {describe,it,expect} from 'vitest';
import {verifyInterestClause} from './import-interest-method';
describe('loan interest clause review',()=>{
  it.each([
    ['actual_365','Interest is calculated daily on the basis of a 365-day year.'],
    ['actual_year','Interest is calculated on the daily balance using 365 (366 in a leap year).'],
    ['periodic','The annual rate is divided by twelve for each monthly period.'],
    ['semi_annual','Interest is compounded semi-annually, not in advance.'],
  ] as const)('recognizes %s with document evidence',(method,quote)=>{
    expect(verifyInterestClause(method,quote,`Agreement: ${quote}`)).toEqual({interestMethod:method,interestMethodQuote:quote});
  });
  it.each(['Interest accrues daily.','Payments are due monthly.','Actual/360','Overdue interest is calculated on a 365-day year.','Actual/365 or Actual/360 depending on currency.'])('does not present %s as a confirmed fixed-365 basis',quote=>{
    expect(verifyInterestClause('actual_365',quote,quote).interestMethod).toBeNull();
  });
  it('discards a quote that is not in the document',()=>{
    expect(verifyInterestClause('actual_365','Actual/365','A vehicle loan.')).toEqual({interestMethod:null,interestMethodQuote:null});
  });
});
