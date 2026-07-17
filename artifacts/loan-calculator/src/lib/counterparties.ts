export interface CuratedCounterparty {
  name: string;
  category: string;
}

export const CURATED_COUNTERPARTIES: CuratedCounterparty[] = [
  // Canadian Big Six banks
  { name: "Royal Bank of Canada", category: "Bank" },
  { name: "Toronto-Dominion Bank", category: "Bank" },
  { name: "Bank of Nova Scotia", category: "Bank" },
  { name: "Bank of Montreal", category: "Bank" },
  { name: "Canadian Imperial Bank of Commerce", category: "Bank" },
  { name: "National Bank of Canada", category: "Bank" },
  // Other Canadian banks / lenders
  { name: "HSBC Bank Canada", category: "Bank" },
  { name: "Canadian Western Bank", category: "Bank" },
  { name: "Business Development Bank of Canada", category: "Bank" },
  { name: "Farm Credit Canada", category: "Bank" },
  // BC credit unions
  { name: "Vancity Credit Union", category: "Credit Union" },
  { name: "Coast Capital Savings", category: "Credit Union" },
  { name: "Prospera Credit Union", category: "Credit Union" },
  { name: "First West Credit Union", category: "Credit Union" },
  { name: "Envision Financial", category: "Credit Union" },
  { name: "Interior Savings Credit Union", category: "Credit Union" },
  { name: "Coastal Community Credit Union", category: "Credit Union" },
  { name: "Gulf & Fraser Fishermen's Credit Union", category: "Credit Union" },
  { name: "BlueShore Financial", category: "Credit Union" },
  { name: "Westminster Savings Credit Union", category: "Credit Union" },
  // Equipment finance companies
  { name: "CWB National Leasing", category: "Equipment Finance" },
  { name: "Element Fleet Management", category: "Equipment Finance" },
  { name: "De Lage Landen Financial Services", category: "Equipment Finance" },
  { name: "Wells Fargo Equipment Finance", category: "Equipment Finance" },
  { name: "Caterpillar Financial Services", category: "Equipment Finance" },
  { name: "John Deere Financial", category: "Equipment Finance" },
  { name: "Toyota Industries Commercial Finance", category: "Equipment Finance" },
  { name: "Roynat Capital", category: "Equipment Finance" },
  // Well-known BC landlords / commercial property
  { name: "QuadReal Property Group", category: "Landlord" },
  { name: "Concert Properties", category: "Landlord" },
  { name: "Bentall Kennedy", category: "Landlord" },
  { name: "Anthem Properties", category: "Landlord" },
  { name: "Bosa Properties", category: "Landlord" },
  { name: "Cadillac Fairview", category: "Landlord" },
  { name: "Oxford Properties", category: "Landlord" },
  { name: "Beedie Development Group", category: "Landlord" },
  { name: "PCI Developments", category: "Landlord" },
  { name: "Wesgroup Properties", category: "Landlord" },
];
