import apiClient from '@/core/api/apiClient';

export interface DiagramData {
  id: string;
  document_id: string;
  mermaid_code: string;
  citations: string[];
  created_at: string | null;
}

export const generateDiagram = async (documentId: string, locale: string = 'en'): Promise<string> => {
  const response = await apiClient.post<{ diagram_id: string }>(`/v1/rag/diagram/${documentId}?locale=${locale}`);
  return response.data.diagram_id;
};

export const getDiagram = async (diagramId: string): Promise<DiagramData> => {
  const response = await apiClient.get<DiagramData>(`/v1/rag/diagram/${diagramId}`);
  return response.data;
};
