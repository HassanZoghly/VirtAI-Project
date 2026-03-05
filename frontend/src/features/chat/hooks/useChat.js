import { useCallback, useEffect } from 'react';
import useConversationReducer from '../../../shared/hooks/useConversationReducer';
import { eventBus, useEventBus } from '../../../shared/hooks/useEventBus';

/**
 * Composite chat hook — owns conversation reducer + WS message wiring.
 *
 * @param {{ send: Function, onMessage: Function }} wsClient
 * @param {{ addUserMessage?: Function, addAssistantMessage?: Function }} [sessionCallbacks]
 * @returns {{
 *   messages: Array,
 *   streamingText: string,
 *   pipelineState: string,
 *   isStreaming: boolean,
 *   error: string|null,
 *   sendMessage: (text: string) => void,
 *   dispatch: Function
 * }}
 */
export function useChat(wsClient, sessionCallbacks = {}) {
  const { send, onMessage } = wsClient;
  const { addUserMessage, addAssistantMessage } = sessionCallbacks;
  const [state, dispatch] = useConversationReducer();

  // Subscribe to chat-related WS messages
  useEffect(() => {
    const unsubs = [
      onMessage('chat.delta', (d) => dispatch({ type: 'CHAT_DELTA', payload: d })),
      onMessage('chat.final', (d) => {
        dispatch({ type: 'CHAT_FINAL', payload: d });
        addAssistantMessage?.(d.message_id + '-assistant', d.text);
        eventBus.emit('chat:response-received', { message_id: d.message_id, text: d.text });
      }),
      onMessage('pipeline.state', (d) => dispatch({ type: 'PIPELINE_STATE', payload: d })),
      onMessage('error', (d) => dispatch({ type: 'ERROR', payload: d })),
    ];
    return () => unsubs.forEach((fn) => fn?.());
  }, [onMessage, dispatch, addAssistantMessage]);

  const sendMessage = useCallback(
    (text) => {
      const trimmed = text.trim();
      if (!trimmed) {
        return;
      }

      const message_id = crypto.randomUUID();
      dispatch({ type: 'USER_MESSAGE', payload: { message_id, text: trimmed } });
      addUserMessage?.(
        { id: message_id, role: 'user', content: trimmed, timestamp: Date.now() },
        trimmed
      );
      send({ type: 'chat.user_message', data: { message_id, text: trimmed } });
      eventBus.emit('chat:message-sent', { message_id, text: trimmed });
    },
    [send, dispatch, addUserMessage]
  );

  // ASR final transcript → auto-send as chat message
  // useEventBus stores handler in a ref, so sendMessage is always current
  useEventBus('asr:final-result', (data) => {
    if (data?.text) {
      sendMessage(data.text);
    }
  });

  // Session switched → reset conversation state
  useEventBus('session:switched', () => {
    dispatch({ type: 'RESET' });
  });

  const isStreaming = state.pipelineState === 'thinking' || state.pipelineState === 'speaking';

  return {
    messages: state.messages,
    streamingText: state.currentMessage,
    pipelineState: state.pipelineState,
    isStreaming,
    error: state.error,
    sendMessage,
    dispatch,
  };
}

export default useChat;
