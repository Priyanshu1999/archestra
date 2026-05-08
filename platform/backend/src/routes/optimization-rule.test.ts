import { OptimizationRuleModel } from "@/models";
import type { FastifyInstanceWithZod } from "@/server";
import { createFastifyInstance } from "@/server";
import { afterEach, beforeEach, describe, expect, test } from "@/test";
import type { User } from "@/types";

describe("optimization rule routes", () => {
  let app: FastifyInstanceWithZod;
  let organizationId: string;
  let user: User;

  const optimizationRulePayload = (
    overrides: Partial<{
      entityType: "organization" | "team" | "agent";
      entityId: string;
      provider: "openai" | "anthropic" | "groq" | "minimax";
      targetModel: string;
      enabled: boolean;
    }> & { provider: "openai" | "anthropic" | "groq" | "minimax" },
  ) => ({
    entityType: overrides.entityType ?? "organization",
    entityId: overrides.entityId ?? organizationId,
    conditions: [{ maxLength: 1000 }],
    provider: overrides.provider,
    targetModel: overrides.targetModel ?? "gpt-4o-mini",
    enabled: overrides.enabled ?? true,
  });

  beforeEach(async ({ makeOrganization, makeUser }) => {
    const organization = await makeOrganization();
    organizationId = organization.id;
    user = await makeUser();

    app = createFastifyInstance();
    app.addHook("onRequest", async (request) => {
      (
        request as typeof request & {
          user: User;
          organizationId: string;
        }
      ).user = user;
      (
        request as typeof request & {
          user: User;
          organizationId: string;
        }
      ).organizationId = organizationId;
    });

    const { default: optimizationRuleRoutes } = await import(
      "./optimization-rule"
    );
    await app.register(optimizationRuleRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  test("rejects organization rule when provider has no accessible key", async ({
    makeLlmProviderApiKey,
    makeSecret,
  }) => {
    const personalSecret = await makeSecret({
      secret: { apiKey: "sk-personal-only" },
    });
    await makeLlmProviderApiKey(organizationId, personalSecret.id, {
      provider: "minimax",
      scope: "personal",
      userId: user.id,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/optimization-rules",
      payload: optimizationRulePayload({
        provider: "minimax",
        targetModel: "minimax-text-01",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain(
      'Cannot create optimization rule for provider "minimax" because no accessible LLM provider API key is configured for the target organization',
    );
  });

  test("creates organization rule when provider has an org key", async ({
    makeLlmProviderApiKey,
    makeSecret,
  }) => {
    const secret = await makeSecret({ secret: { apiKey: "sk-org-openai" } });
    await makeLlmProviderApiKey(organizationId, secret.id, {
      provider: "openai",
      scope: "org",
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/optimization-rules",
      payload: optimizationRulePayload({
        provider: "openai",
        targetModel: "gpt-4o-mini",
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entityType: "organization",
      entityId: organizationId,
      provider: "openai",
      targetModel: "gpt-4o-mini",
    });
  });

  test("creates team rule when provider has a key for that team", async ({
    makeLlmProviderApiKey,
    makeSecret,
    makeTeam,
  }) => {
    const team = await makeTeam(organizationId, user.id);
    const secret = await makeSecret({ secret: { apiKey: "sk-team-groq" } });
    await makeLlmProviderApiKey(organizationId, secret.id, {
      provider: "groq",
      scope: "team",
      teamId: team.id,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/optimization-rules",
      payload: optimizationRulePayload({
        entityType: "team",
        entityId: team.id,
        provider: "groq",
        targetModel: "llama-3.1-8b-instant",
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entityType: "team",
      entityId: team.id,
      provider: "groq",
    });
  });

  test("does not count author personal keys for org-scoped agent rules", async ({
    makeAgent,
    makeLlmProviderApiKey,
    makeSecret,
  }) => {
    const agent = await makeAgent({
      organizationId,
      scope: "org",
      authorId: user.id,
    });
    const personalSecret = await makeSecret({
      secret: { apiKey: "sk-author-personal" },
    });
    await makeLlmProviderApiKey(organizationId, personalSecret.id, {
      provider: "minimax",
      scope: "personal",
      userId: user.id,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/optimization-rules",
      payload: optimizationRulePayload({
        entityType: "agent",
        entityId: agent.id,
        provider: "minimax",
        targetModel: "minimax-text-01",
      }),
    });

    expect(response.statusCode).toBe(400);
  });

  test("creates personal agent rule when provider has the owner's personal key", async ({
    makeAgent,
    makeLlmProviderApiKey,
    makeSecret,
  }) => {
    const agent = await makeAgent({
      organizationId,
      scope: "personal",
      authorId: user.id,
    });
    const personalSecret = await makeSecret({
      secret: { apiKey: "sk-owner-personal" },
    });
    await makeLlmProviderApiKey(organizationId, personalSecret.id, {
      provider: "minimax",
      scope: "personal",
      userId: user.id,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/optimization-rules",
      payload: optimizationRulePayload({
        entityType: "agent",
        entityId: agent.id,
        provider: "minimax",
        targetModel: "minimax-text-01",
      }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      entityType: "agent",
      entityId: agent.id,
      provider: "minimax",
    });
  });

  test("rejects update when new provider has no accessible key", async ({
    makeLlmProviderApiKey,
    makeSecret,
  }) => {
    const secret = await makeSecret({ secret: { apiKey: "sk-org-openai" } });
    await makeLlmProviderApiKey(organizationId, secret.id, {
      provider: "openai",
      scope: "org",
    });
    const rule = await OptimizationRuleModel.create(
      optimizationRulePayload({
        provider: "openai",
        targetModel: "gpt-4o-mini",
      }),
    );

    const response = await app.inject({
      method: "PUT",
      url: `/api/optimization-rules/${rule.id}`,
      payload: {
        provider: "anthropic",
        targetModel: "claude-3-5-haiku-latest",
      },
    });

    expect(response.statusCode).toBe(400);

    const unchangedRule = await OptimizationRuleModel.findById(rule.id);
    expect(unchangedRule).toMatchObject({
      provider: "openai",
      targetModel: "gpt-4o-mini",
    });
  });
});
