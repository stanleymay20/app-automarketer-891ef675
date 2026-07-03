import { describe, it, expect } from "vitest";
import { parseProspectCsv, parseProspectCsvDetailed } from "./useProspects";

const nativeHeader = "name,url,description,contact_email,contact_name,contact_linkedin,contact_role,industry,company_size,notes,stage,category";
const nativeRow = 'TRUMPF SE + Co. KG,https://trumpf.com,Precision machine-tool manufacturer,,,,COO,German manufacturing,"Large (>10,000 employees)",Some notes,new,customer';

// Exactly the format documented on the Quantivis LOI campaign page
// (src/lib/quantivis-loi-campaign.ts) — this is the format that previously
// produced "No valid rows found" when fed into the general Prospects importer.
const campaignHeader = "company_name,sector,decision_maker_role,linkedin_url,email,reason_they_fit_quantivis,outreach_status,loi_status";
const campaignRow = 'Muster Maschinenbau GmbH,German manufacturing,COO / Head of Operations / AI Transformation Lead,https://www.linkedin.com/company/example,first.last@example.de,"Manufacturing operator likely evaluating AI governance, operational risk, and evidence-backed transformation decisions.",drafted,not_requested';

describe("parseProspectCsv - native Prospects schema", () => {
  it("parses the native header/row format", () => {
    const rows = parseProspectCsv(`${nativeHeader}\n${nativeRow}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("TRUMPF SE + Co. KG");
    expect(rows[0].stage).toBe("new");
    expect(rows[0].category).toBe("customer");
  });
});

describe("parseProspectCsv - Quantivis LOI campaign schema (regression)", () => {
  it("parses company_name as name instead of returning zero rows", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Muster Maschinenbau GmbH");
  });

  it("maps sector -> industry", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows[0].industry).toBe("German manufacturing");
  });

  it("maps decision_maker_role -> contact_role", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows[0].contact_role).toBe("COO / Head of Operations / AI Transformation Lead");
  });

  it("maps reason_they_fit_quantivis -> description", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows[0].description).toMatch(/Manufacturing operator/);
  });

  it("maps linkedin_url -> contact_linkedin and email -> contact_email", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows[0].contact_linkedin).toBe("https://www.linkedin.com/company/example");
    expect(rows[0].contact_email).toBe("first.last@example.de");
  });

  it("maps outreach_status 'drafted' -> pipeline stage 'new'", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows[0].stage).toBe("new");
  });

  it("folds loi_status into notes instead of dropping it", () => {
    const rows = parseProspectCsv(`${campaignHeader}\n${campaignRow}`);
    expect(rows[0].notes).toMatch(/LOI status: not_requested/);
  });
});

describe("parseProspectCsvDetailed - diagnostics", () => {
  it("reports headers found even when zero rows are valid", () => {
    const { rows, headersFound, headersRecognized } = parseProspectCsvDetailed(
      "foo,bar\nbaz,qux"
    );
    expect(rows).toHaveLength(0);
    expect(headersFound).toEqual(["foo", "bar"]);
    expect(headersRecognized).toEqual([]);
  });

  it("returns empty arrays for an empty file", () => {
    const result = parseProspectCsvDetailed("");
    expect(result.rows).toHaveLength(0);
    expect(result.headersFound).toHaveLength(0);
  });
});
