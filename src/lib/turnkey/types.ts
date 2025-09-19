export interface CreateSubOrgResponse {
  success: boolean;
  result?: {
    activity: {
      id: string;
      organizationId: string;
      status: string;
      type: string;
      intent: any; // You can further type this if you know the structure
      result: CreateSubOrganizationResultV7;
      votes: any[]; // You can further type this if you know the structure
      fingerprint: string;
      canApprove: boolean;
      canReject: boolean;
      createdAt: { seconds: string; nanos: string };
      updatedAt: { seconds: string; nanos: string };
      failure: any | null;
    };
  };
  error?: string;
}

interface CreateSubOrganizationResultV7 {
  subOrganizationId: string;
  wallet: {
    walletId: string;
    addresses: string[];
  };
  rootUserIds: string[];
}
