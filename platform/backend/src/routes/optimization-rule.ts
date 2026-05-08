import { RouteId } from "@shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { OptimizationRuleModel } from "@/models";
import {
  ApiError,
  constructResponseSchema,
  DeleteObjectResponseSchema,
  InsertOptimizationRuleSchema,
  SelectOptimizationRuleSchema,
  UpdateOptimizationRuleSchema,
  UuidIdSchema,
} from "@/types";

const optimizationRuleRoutes: FastifyPluginAsyncZod = async (fastify) => {
  fastify.get(
    "/api/optimization-rules",
    {
      schema: {
        operationId: RouteId.GetOptimizationRules,
        description: "Get all optimization rules for the organization",
        tags: ["Optimization Rules"],
        response: constructResponseSchema(
          z.array(SelectOptimizationRuleSchema),
        ),
      },
    },
    async (request, reply) => {
      const rules = await OptimizationRuleModel.findByOrganizationId(
        request.organizationId,
      );

      return reply.status(200).send(rules);
    },
  );

  fastify.post(
    "/api/optimization-rules",
    {
      schema: {
        operationId: RouteId.CreateOptimizationRule,
        description: "Create a new optimization rule for the organization",
        tags: ["Optimization Rules"],
        body: InsertOptimizationRuleSchema,
        response: constructResponseSchema(SelectOptimizationRuleSchema),
      },
    },
    async (request, reply) => {
      await validateOptimizationRuleTarget({
        entityType: request.body.entityType,
        entityId: request.body.entityId,
        organizationId: request.organizationId,
        provider: request.body.provider,
      });

      const rule = await OptimizationRuleModel.create(request.body);

      return reply.send(rule);
    },
  );

  fastify.put(
    "/api/optimization-rules/:id",
    {
      schema: {
        operationId: RouteId.UpdateOptimizationRule,
        description: "Update an optimization rule",
        tags: ["Optimization Rules"],
        params: z.object({
          id: UuidIdSchema,
        }),
        body: UpdateOptimizationRuleSchema.partial(),
        response: constructResponseSchema(SelectOptimizationRuleSchema),
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const existingRule = await OptimizationRuleModel.findById(id);

      if (!existingRule) {
        throw new ApiError(404, "Optimization rule not found");
      }

      const nextRule = {
        ...existingRule,
        ...request.body,
      };
      await validateOptimizationRuleTarget({
        entityType: nextRule.entityType,
        entityId: nextRule.entityId,
        organizationId: request.organizationId,
        provider: nextRule.provider,
      });

      const rule = await OptimizationRuleModel.update(id, request.body);

      if (!rule) {
        throw new ApiError(404, "Optimization rule not found");
      }

      return reply.send(rule);
    },
  );

  fastify.delete(
    "/api/optimization-rules/:id",
    {
      schema: {
        operationId: RouteId.DeleteOptimizationRule,
        description: "Delete an optimization rule",
        tags: ["Optimization Rules"],
        params: z.object({
          id: UuidIdSchema,
        }),
        response: constructResponseSchema(DeleteObjectResponseSchema),
      },
    },
    async ({ params: { id } }, reply) => {
      const deleted = await OptimizationRuleModel.delete(id);

      if (!deleted) {
        throw new ApiError(404, "Optimization rule not found");
      }

      return reply.send({ success: true });
    },
  );
};

async function validateOptimizationRuleTarget(params: {
  entityType: "organization" | "team" | "agent";
  entityId: string;
  organizationId: string;
  provider: z.infer<typeof InsertOptimizationRuleSchema>["provider"];
}): Promise<void> {
  const belongsToOrganization =
    await OptimizationRuleModel.entityBelongsToOrganization({
      entityType: params.entityType,
      entityId: params.entityId,
      organizationId: params.organizationId,
    });

  if (!belongsToOrganization) {
    if (params.entityType === "organization") {
      throw new ApiError(403, "Cannot create rule for different organization");
    }
    throw new ApiError(
      404,
      `Optimization rule target ${params.entityType} not found in this organization`,
    );
  }

  const hasConfiguredProvider =
    await OptimizationRuleModel.hasConfiguredProviderForEntity({
      entityType: params.entityType,
      entityId: params.entityId,
      organizationId: params.organizationId,
      provider: params.provider,
    });

  if (!hasConfiguredProvider) {
    throw new ApiError(
      400,
      `Cannot create optimization rule for provider "${params.provider}" because no accessible LLM provider API key is configured for the target ${params.entityType}`,
    );
  }
}

export default optimizationRuleRoutes;
