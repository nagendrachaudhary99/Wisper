/**
 * RunEngine is the API's only dependency on workflow orchestration.
 * Production wiring uses Temporal; tests use a fake. The API never assumes
 * how execution happens - only that runs start once and decisions get delivered.
 */
export interface RunEngine {
  startChatRun(args: { tenantId: string; runId: string; text: string }): Promise<void>;
  signalApproval(args: {
    tenantId: string;
    runId: string;
    approvalId: string;
    approved: boolean;
    decidedBy: string;
  }): Promise<void>;
}

export class TemporalRunEngine implements RunEngine {
  private clientPromise: Promise<import("@temporalio/client").WorkflowClient>;
  private taskQueue: string;

  constructor(address: string, namespace: string, taskQueue: string) {
    this.taskQueue = taskQueue;
    this.clientPromise = (async () => {
      const { Connection, WorkflowClient } = await import("@temporalio/client");
      const connection = await Connection.connect({ address });
      return new WorkflowClient({ connection, namespace });
    })();
  }

  private handleId(runId: string): string {
    return `chat-${runId}`;
  }

  async startChatRun(args: { tenantId: string; runId: string; text: string }): Promise<void> {
    const client = await this.clientPromise;
    try {
      await client.start("chatWorkflow", {
        workflowId: this.handleId(args.runId),
        taskQueue: this.taskQueue,
        args: [{ tenantId: args.tenantId, runId: args.runId, text: args.text }],
        // Same runId => same workflowId => a duplicate start is rejected and
        // treated as success below. One run, one execution, ever.
        workflowIdReusePolicy: "ALLOW_DUPLICATE_FAILED_ONLY",
        workflowIdConflictPolicy: "FAIL",
      });
    } catch (err) {
      if (err instanceof Error && err.name === "WorkflowExecutionAlreadyStartedError") return;
      throw err;
    }
  }

  async signalApproval(args: {
    tenantId: string; runId: string; approvalId: string; approved: boolean; decidedBy: string;
  }): Promise<void> {
    const client = await this.clientPromise;
    const handle = client.getHandle(this.handleId(args.runId));
    await handle.signal("approvalDecision", {
      approvalId: args.approvalId,
      approved: args.approved,
      decidedBy: args.decidedBy,
    });
  }
}
