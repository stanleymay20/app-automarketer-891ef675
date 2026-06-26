export const QUANTIVIS_LOI_CAMPAIGN_NAME = "Quantivis EXIST LOI Outreach";

export type QuantivisLoiIcpField =
  | "company_name"
  | "sector"
  | "decision_maker_role"
  | "linkedin_url"
  | "email"
  | "reason_they_fit_quantivis"
  | "outreach_status"
  | "loi_status";

export interface QuantivisLoiMessageTemplate {
  id: string;
  label: string;
  channel: "linkedin" | "email" | "loi";
  subject?: string;
  body: string;
}

export interface QuantivisLoiCampaignTemplate {
  name: string;
  purpose: string;
  targetAudience: string[];
  icpFields: { key: QuantivisLoiIcpField; label: string; required: boolean }[];
  messageTemplates: QuantivisLoiMessageTemplate[];
  goals: {
    companiesContacted: number;
    replies: number;
    discoveryCalls: number;
    pilotDiscussions: number;
    signedLois: number;
  };
  safeSendingRules: {
    approvalRequired: boolean;
    maxLinkedInDraftsPerDay: number;
    maxEmailDraftsPerDay: number;
    sendingWindow: {
      start: string;
      end: string;
      timezone: string;
    };
  };
  csvHeaders: QuantivisLoiIcpField[];
  csvExampleRows: Record<QuantivisLoiIcpField, string>[];
}

export const quantivisLoiCampaignTemplate: QuantivisLoiCampaignTemplate = {
  name: QUANTIVIS_LOI_CAMPAIGN_NAME,
  purpose:
    "Prepare reviewable LinkedIn and email outreach drafts for potential Quantivis EXIST letter-of-intent supporters. No message is sent automatically.",
  targetAudience: [
    "German manufacturing companies",
    "Logistics companies",
    "Retail/distribution companies",
    "AI governance/compliance consultancies",
  ],
  icpFields: [
    { key: "company_name", label: "Company name", required: true },
    { key: "sector", label: "Sector", required: true },
    { key: "decision_maker_role", label: "Decision maker role", required: true },
    { key: "linkedin_url", label: "LinkedIn URL", required: false },
    { key: "email", label: "Email", required: false },
    { key: "reason_they_fit_quantivis", label: "Reason they fit Quantivis", required: true },
    { key: "outreach_status", label: "Outreach status", required: true },
    { key: "loi_status", label: "LOI status", required: true },
  ],
  messageTemplates: [
    {
      id: "linkedin_connection_request",
      label: "LinkedIn connection request",
      channel: "linkedin",
      body:
        "Hi {{first_name}}, I’m building Quantivis, a decision-intelligence platform for evidence-based AI governance and operating decisions. Your work at {{company_name}} looks relevant to the manufacturing/logistics/retail adoption problem we’re studying in Germany. Open to connecting?",
    },
    {
      id: "linkedin_follow_up",
      label: "LinkedIn follow-up",
      channel: "linkedin",
      body:
        "Thanks for connecting, {{first_name}}. Short context: Quantivis helps teams document high-impact decisions, AI usage, evidence, risks, and outcomes in one audit-ready workflow. I’m gathering EXIST LOIs from German operators/advisors who see this need. Would a 15-minute call next week make sense?",
    },
    {
      id: "short_email_15_minute_call",
      label: "Short email asking for 15-minute call",
      channel: "email",
      subject: "Quick question about AI decision governance at {{company_name}}",
      body:
        "Hi {{first_name}},\n\nI’m Stanley, founder of Quantivis. We’re preparing an EXIST application around decision intelligence for companies adopting AI in operations, compliance, and strategic planning.\n\n{{company_name}} looks relevant because {{reason_they_fit_quantivis}}.\n\nWould you be open to a 15-minute call to pressure-test whether this problem matters in your environment? If there is fit, I may also ask whether a non-binding LOI would be appropriate for the EXIST file.\n\nBest,\nStanley",
    },
    {
      id: "loi_request_after_interest",
      label: "LOI request after interest",
      channel: "loi",
      subject: "Non-binding LOI for Quantivis / EXIST application",
      body:
        "Hi {{first_name}},\n\nThank you again for the conversation. Based on your feedback, I’m preparing a short non-binding Letter of Intent for Quantivis as part of the EXIST application.\n\nThe LOI would simply state that {{company_name}} sees relevance in the problem area and is open to evaluating a pilot discussion when the product is ready. It does not create a purchase obligation.\n\nIf you are comfortable, I can send a one-page draft for review and edits.\n\nBest,\nStanley",
    },
  ],
  goals: {
    companiesContacted: 30,
    replies: 10,
    discoveryCalls: 5,
    pilotDiscussions: 2,
    signedLois: 1,
  },
  safeSendingRules: {
    approvalRequired: true,
    maxLinkedInDraftsPerDay: 20,
    maxEmailDraftsPerDay: 10,
    sendingWindow: {
      start: "09:00",
      end: "17:00",
      timezone: "Europe/Berlin",
    },
  },
  csvHeaders: [
    "company_name",
    "sector",
    "decision_maker_role",
    "linkedin_url",
    "email",
    "reason_they_fit_quantivis",
    "outreach_status",
    "loi_status",
  ],
  csvExampleRows: [
    {
      company_name: "Muster Maschinenbau GmbH",
      sector: "German manufacturing",
      decision_maker_role: "COO / Head of Operations / AI Transformation Lead",
      linkedin_url: "https://www.linkedin.com/company/example",
      email: "first.last@example.de",
      reason_they_fit_quantivis:
        "Manufacturing operator likely evaluating AI governance, operational risk, and evidence-backed transformation decisions.",
      outreach_status: "drafted",
      loi_status: "not_requested",
    },
  ],
};

export function quantivisLoiCsvHeaderLine() {
  return quantivisLoiCampaignTemplate.csvHeaders.join(",");
}

function escapeCsvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function quantivisLoiCsvExample() {
  const header = quantivisLoiCsvHeaderLine();
  const rows = quantivisLoiCampaignTemplate.csvExampleRows.map((row) =>
    quantivisLoiCampaignTemplate.csvHeaders.map((key) => escapeCsvCell(row[key])).join(","),
  );
  return [header, ...rows].join("\n");
}
