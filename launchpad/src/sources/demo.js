// Demo source: fictional companies, so the whole pipeline can run offline.
// It deliberately includes the traps from the brief: ghost postings, "entry level" roles that want
// 5 years or a Master's, CS-only degrees, clearance, commission-only funnels, senior titles.
export const meta = { id: 'demo', label: 'Demo listings', kind: 'demo' };

const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

const LISTINGS = [
  ['Northwind Cloud', 'Sales Development Representative', 'San Jose, CA', 1, 'full-time', { min: 60000, max: 65000, type: 'base' }, true,
    'Join our SaaS sales team. You will prospect outbound into mid-market accounts, book meetings for Account Executives, and manage pipeline in Salesforce. 0-1 years of experience; new grads welcome. OTE $85,000 - $95,000.'],
  ['Bluepeak Software', 'Associate Product Manager', 'Remote (US)', 2, 'full-time', { min: 95000, max: 115000, type: 'base' }, true,
    'Our APM program is for early career builders. Work cross-functional with engineering and design, write requirements, and own a roadmap area. Bachelor\'s degree in business, MIS, or related field.'],
  ['Harbor Freightways', 'Supply Chain Analyst I', 'Stockton, CA', 3, 'full-time', null, true,
    'Analyze inventory and vendor KPIs, build forecast models in Excel and SAP, and support lean process improvement across our logistics network. Salary range: $68,000 - $78,000 per year. 1+ years of experience in operations or supply chain preferred.'],
  ['Cedar Analytics', 'Business Analyst, Associate', 'San Francisco, CA', 0, 'full-time', { min: 72000, max: 88000, type: 'base' }, true,
    'Gather requirements from stakeholders, write SQL, and build dashboards in Tableau. Experience with NetSuite or another ERP is a plus. 0-2 years experience.'],
  ['Lumen Logistics', 'Operations Coordinator', 'Tracy, CA', 4, 'full-time', null, true,
    'Coordinate inbound and outbound fulfillment, track warehouse KPIs, and partner with vendors. Pay: $28 - $32 per hour. Great role for a recent graduate.'],
  ['Atlas Systems', 'Program Coordinator, University Grad', 'Sacramento, CA', 5, 'full-time', { min: 62000, max: 70000, type: 'base' }, true,
    'Support program managers on schedules, risks and stakeholder updates. Agile experience a plus. Graduating seniors welcome; start after graduation.'],
  ['Quarry Labs', 'Business Development Representative', 'Remote (US)', 6, 'full-time', null, true,
    'Outbound prospecting into enterprise accounts using HubSpot. 2+ years of sales experience. Base $55,000 plus commission, OTE $90,000.'],
  // — traps the rules should catch —
  ['Vertex Dynamics', 'Business Analyst', 'San Jose, CA', 120, 'full-time', null, true,
    'Analyze requirements and build dashboards in Power BI. 0-2 years of experience.'],
  ['Pinnacle Federal', 'Systems Analyst', 'Sacramento, CA', 2, 'full-time', { min: 75000, max: 90000, type: 'base' }, true,
    'Support business systems for a federal client. Active Secret clearance required. SQL and requirements gathering.'],
  ['Granite Partners', 'Operations Analyst', 'San Francisco, CA', 3, 'full-time', { min: 80000, max: 95000, type: 'base' }, true,
    'Process improvement and KPI reporting. An MBA is required for this role.'],
  ['Octave Robotics', 'Business Systems Analyst', 'San Jose, CA', 2, 'full-time', { min: 85000, max: 100000, type: 'base' }, true,
    'Own our ERP integrations. Bachelor\'s degree in Computer Science required. SQL, APIs.'],
  ['Summit Direct', 'Sales Associate', 'Stockton, CA', 1, 'contract', null, true,
    'Unlimited earning potential! This is a 1099 independent contractor, commission-only sales role. Prospecting and cold calls.'],
  ['Meridian Health Tech', 'Senior Product Manager', 'Remote (US)', 2, 'full-time', { min: 160000, max: 190000, type: 'base' }, true,
    'Lead roadmap for our platform. 7+ years of product management experience.'],
  ['Brightline Retail', 'Inventory Planner', 'Sacramento, CA', 4, 'full-time', { min: 66000, max: 74000, type: 'base' }, true,
    'Forecast demand and manage vendor purchase orders in SAP. Requires 5+ years of experience in inventory planning.'],
  ['Nimbus Talent', 'Future Opportunities — Analyst Talent Community', 'Remote (US)', 1, 'full-time', null, true,
    'Join our talent community to be considered for future opportunities. This is an evergreen posting.'],
  ['Copperleaf Energy', 'Project Coordinator', 'Denver, CO', 2, 'full-time', { min: 60000, max: 68000, type: 'base' }, true,
    'Coordinate project schedules and stakeholder updates. Agile a plus.'],
  ['Juniper Fintech', 'Customer Success Associate', 'San Francisco, CA', 3, 'full-time', { min: 64000, max: 72000, type: 'base' }, false,
    'Onboard SaaS customers and manage renewals pipeline in Salesforce. 0-1 years of experience.'],
];

export async function search(brief) {
  if (!brief.sources.demo?.enabled) return { skipped: true, jobs: [] };
  const jobs = LISTINGS.map(([company, title, location, age, type, comp, live, description], i) => ({
    source: 'demo',
    sourceKind: 'demo',
    externalId: `demo-${i + 1}`,
    company,
    title,
    location,
    remote: /remote/i.test(location),
    url: `https://example.com/careers/${company.toLowerCase().replace(/\W+/g, '-')}/${i + 1}`,
    postedAt: daysAgo(age),
    employmentType: type,
    description,
    compensation: comp,
    _demoLive: live, // stands in for the live-page check
  }));
  return { jobs };
}
