import { useReducer } from 'react';

/**
 * ConversationState interface:
 * {
 *   messages: Message[],
 *   currentMessage: string,
 *   pipelineState: 'idle' | 'thinking' | 'speaking' | 'error',
 *   activeMessageId: string | null,
 *   error: string | null
 * }
 *
 * Message interface:
 * {
 *   id: string,
 *   role: 'user' | 'assistant',
 *   content: string,
 *   timestamp: number,
 *   isStreaming?: boolean
 * }
 */

const initialState = {
  messages: [],
  currentMessage: '',
  pipelineState: 'idle',
  activeMessageId: null,
  error: null,
};

/**
 * Reducer for conversation state management
 *
 * Preconditions:
 * - state is valid ConversationState
 * - action has valid type
 *
 * Postconditions:
 * - Returns new state (immutable)
 * - State transitions are valid
 *
 * @param {ConversationState} state - Current state
 * @param {Object} action - Action with type and payload
 * @returns {ConversationState} New state
 */
function conversationReducer(state, action) {
  switch (action.type) {
    case 'CHAT_DELTA':
      // Append token to current streaming message
      return {
        ...state,
        currentMessage: state.currentMessage + action.payload.delta,
      };

    case 'CHAT_FINAL': {
      const alreadyExists = state.messages.some((m) => m.id === action.payload.message_id);
      // Finalize assistant message
      const newMessage = {
        id: action.payload.message_id,
        role: 'assistant',
        content: action.payload.text,
        timestamp: Date.now(),
        isStreaming: false,
      };
      return {
        ...state,
        messages: alreadyExists ? state.messages : [...state.messages, newMessage],
        currentMessage: '',
        activeMessageId: null,
      };
    }

    case 'PIPELINE_STATE':
      // Update pipeline state
      return {
        ...state,
        pipelineState: action.payload.state,
        error: action.payload.state === 'error' ? state.error : null,
      };

    case 'USER_MESSAGE': {
      const alreadyExists = state.messages.some((m) => m.id === action.payload.message_id);
      // Add user message
      const userMessage = {
        id: action.payload.message_id,
        role: 'user',
        content: action.payload.text,
        timestamp: Date.now(),
      };
      return {
        ...state,
        messages: alreadyExists ? state.messages : [...state.messages, userMessage],
        activeMessageId: action.payload.message_id,
        currentMessage: '',
        error: null,
      };
    }

    case 'ERROR':
      // Set error state
      return {
        ...state,
        error: action.payload.message,
        pipelineState: 'error',
      };

    case 'CLEAR_ERROR':
      // Clear error state
      return {
        ...state,
        error: null,
        pipelineState: state.pipelineState === 'error' ? 'idle' : state.pipelineState,
      };

    case 'RESET':
      // Reset to initial state
      return initialState;

    default:
      return state;
  }
}

/**
 * Custom hook for conversation state management
 *
 * @returns {[ConversationState, Function]} State and dispatch function
 */
export function useConversationReducer() {
  const [state, dispatch] = useReducer(conversationReducer, initialState);

  return [state, dispatch];
}

export default useConversationReducer;
