import { describe, expect, it } from "vitest";
import {
  quantivisLoiCampaignTemplate,
  quantivisLoiCsvExample,
  quantivisLoiCsvHeaderLine,
} from "./quantivis-loi-campaign";

describe("Quantivis LOI campaign template", () => {
  it("defines the requested campaign name and target audiences", () => {
    expect(quantivisLoiCampaignTemplate.name).toBe("Quantivis EXIST LOI Outreach");
    expect(quantivisLoiCampaignTemplate.targetAudience).toEqual([
      "German manufacturing companies",
      "Logistics companies",
      "Retail/distribution companies",
      "AI governance/compliance consultancies",
    ]);
  });

  it("includes the required ICP fields and CSV headers", () => {
    expect(quantivisLoiCampaignTemplate.csvHeaders).toEqual([
      "company_name",
      "sector",
      "decision_maker_role",
      "linkedin_url",
      "email",
      "reason_they_fit_quantivis",
      "outreach_status",
      "loi_status",
    ]);
    expect(quantivisLoiCsvHeaderLine()).toBe(
      "company_name,sector,decision_maker_role,linkedin_url,email,reason_they_fit_quantivis,outreach_status,loi_status",
    );
  });

  it("contains all four requested message templates", () => {
    expect(quantivisLoiCampaignTemplate.messageTemplates.map((template) => template.id)).toEqual([
      "linkedin_connection_request",
      "linkedin_follow_up",
      "short_email_15_minute_call",
      "loi_request_after_interest",
    ]);
  });

  it("keeps outreach draft-only and bounded by safe sending rules", () => {
    expect(quantivisLoiCampaignTemplate.safeSendingRules).toMatchObject({
      approvalRequired: true,
      maxLinkedInDraftsPerDay: 20,
      maxEmailDraftsPerDay: 10,
      sendingWindow: {
        start: "09:00",
        end: "17:00",
        timezone: "Europe/Berlin",
      },
    });
  });

  it("sets the requested campaign goals", () => {
    expect(quantivisLoiCampaignTemplate.goals).toEqual({
      companiesContacted: 30,
      replies: 10,
      discoveryCalls: 5,
      pilotDiscussions: 2,
      signedLois: 1,
    });
  });

  it("exports a reviewable CSV example", () => {
    expect(quantivisLoiCsvExample()).toContain("Muster Maschinenbau GmbH");
    expect(quantivisLoiCsvExample()).toContain("not_requested");
  });
});
