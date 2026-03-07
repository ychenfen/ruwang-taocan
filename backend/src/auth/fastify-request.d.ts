import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    agentId?: string;
  }
}

