import { describe, expect, it } from "vitest";
import {
  deriveDisplayStage,
  getStageCopy,
  stageDestination,
  toStageLabel,
} from "./stages.js";

describe("stage helpers", () => {
  it("promotes submitted intake to account access for display", () => {
    expect(
      deriveDisplayStage("intake_form", { status: "submitted" }, null)
    ).toBe("account_access");
  });

  it("keeps unknown stages on the intake fallback", () => {
    expect(getStageCopy("unknown_stage").title).toContain("Step 2 of 7");
  });

  it("formats labels and destinations consistently", () => {
    expect(toStageLabel("prelaunch_review")).toBe("Pre-Launch Review");
    expect(stageDestination("account_access")).toBe(
      "/p11-onboarding-account-access.html"
    );
  });
});
