import { OrganizationModel } from "@/models";
import { describe, expect, test } from "@/test";
import { shouldApplyToonCompression } from "./toon-conversion";

describe("shouldApplyToonCompression", () => {
  test("honors team TOON settings when organization-level TOON is disabled", async ({
    makeAgent,
    makeOrganization,
    makeTeam,
    makeUser,
  }) => {
    const user = await makeUser();
    const organization = await makeOrganization();
    await OrganizationModel.patch(organization.id, {
      compressionScope: "organization",
      convertToolResultsToToon: false,
    });
    const team = await makeTeam(organization.id, user.id, {
      convertToolResultsToToon: true,
    });
    const agent = await makeAgent({
      organizationId: organization.id,
      scope: "team",
      teams: [team.id],
    });

    await expect(shouldApplyToonCompression(agent.id)).resolves.toBe(true);
  });

  test("keeps team scope limited to teams with TOON enabled", async ({
    makeAgent,
    makeOrganization,
    makeTeam,
    makeUser,
  }) => {
    const user = await makeUser();
    const organization = await makeOrganization();
    await OrganizationModel.patch(organization.id, {
      compressionScope: "team",
      convertToolResultsToToon: true,
    });
    const team = await makeTeam(organization.id, user.id, {
      convertToolResultsToToon: false,
    });
    const agent = await makeAgent({
      organizationId: organization.id,
      scope: "team",
      teams: [team.id],
    });

    await expect(shouldApplyToonCompression(agent.id)).resolves.toBe(false);
  });

  test("uses organization-level TOON when organization scope is enabled", async ({
    makeAgent,
    makeOrganization,
  }) => {
    const organization = await makeOrganization();
    await OrganizationModel.patch(organization.id, {
      compressionScope: "organization",
      convertToolResultsToToon: true,
    });
    const agent = await makeAgent({
      organizationId: organization.id,
      scope: "org",
      teams: [],
    });

    await expect(shouldApplyToonCompression(agent.id)).resolves.toBe(true);
  });
});
