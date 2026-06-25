import apiClient from '@/core/api/apiClient';

export interface VisualizationResponse {
  message_id: string;
  image_url?: string;
  unavailable?: boolean;
  reason?: string;
}

export const getVisualization = async (messageId: string): Promise<VisualizationResponse> => {
  const response = await apiClient.get<VisualizationResponse>(`/v1/rag/visualization/${messageId}`);
  return response.data;
};
