export interface ISession {
  id: string;
  title: string;
  created_at?: string | number;
  updated_at?: string | number;
  messages?: IMessage[];
  messages_loaded?: boolean;
  documents?: any[];
  message_count?: number;
}

export interface IMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number | string;
}
