import { useState, useEffect, useCallback } from 'react';

interface BulkMessageInput {
  phone_number: string;
  message: string;
}

interface MessageSentData {
  phoneNumber: string;
  status: string;
}

interface MessageFailedData {
  phoneNumber: string;
  error: string;
}

interface BulkProgressData {
  current: number;
  total: number;
  phoneNumber: string;
  status: string;
}

interface BulkCompletedData {
  successCount: number;
  failedCount: number;
  logs: any[];
}

interface ServiceErrorData {
  errorMessage: string;
}

interface UseWhatsAppServiceReturn {
  isRunning: boolean;
  isProcessing: boolean;
  progress: { current: number; total: number };
  logs: any[];
  sendMessage: (phone: string, msg: string) => Promise<void>;
  startService: () => Promise<void>;
  stopService: () => Promise<void>;
  startBulk: (data: BulkMessageInput[]) => Promise<void>;
  stopBulk: () => Promise<void>;
  error: string | null;
}

export const useWhatsAppService = (): UseWhatsAppServiceReturn => {
  const [isRunning, setIsRunning] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to all events
    const unsubReady = window.api.onReady(() => {
      setIsRunning(true);
      setError(null);
      console.log('✅ WhatsApp service ready');
    });

    const unsubStopped = window.api.onStopped(() => {
      setIsRunning(false);
      setIsProcessing(false);
      console.log('🛑 WhatsApp service stopped');
    });

    const unsubMessageSent = window.api.onMessageSent((data: MessageSentData) => {
      console.log('✅ Message sent:', data);
    });

    const unsubMessageFailed = window.api.onMessageFailed((data: MessageFailedData) => {
      setError(data.error);
      console.error('❌ Message failed:', data);
    });

    const unsubBulkProgress = window.api.onBulkProgress((data: BulkProgressData) => {
      setProgress({ current: data.current, total: data.total });
      console.log(`📊 Progress: ${data.current}/${data.total} - ${data.phoneNumber}`);
    });

    const unsubBulkCompleted = window.api.onBulkCompleted((data: BulkCompletedData) => {
      setLogs(data.logs);
      setIsProcessing(false);
      setProgress({ current: 0, total: 0 });
      console.log('✅ Bulk messaging completed:', data);
      alert(`✅ Bulk messaging completed!\n\nSuccess: ${data.successCount}\nFailed: ${data.failedCount}`);
    });

    const unsubServiceError = window.api.onServiceError((data: ServiceErrorData) => {
      setError(data.errorMessage);
      console.error('❌ Service error:', data.errorMessage);
      console.error('Full error details:', data);
    });

    // Cleanup all listeners on unmount
    return () => {
      unsubReady();
      unsubStopped();
      unsubMessageSent();
      unsubMessageFailed();
      unsubBulkProgress();
      unsubBulkCompleted();
      unsubServiceError();
    };
  }, []);

  const startService = useCallback(async () => {
    try {
      setError(null);
      const result = await window.api.startService();
      if (!result.success && result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const stopService = useCallback(async () => {
    try {
      await window.api.stopService();
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const sendMessage = useCallback(async (phone: string, msg: string) => {
    try {
      setError(null);
      // Ensure phone is string
      const phoneStr = String(phone);
      const result = await window.api.sendMessage(phoneStr, msg);
      if (!result.success && result.error) {
        setError(result.error);
        throw new Error(result.error);
      }
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  }, []);

  const startBulk = useCallback(async (data: BulkMessageInput[]) => {
    setIsProcessing(true);
    setProgress({ current: 0, total: data.length });
    setError(null);
    
    try {
      const result = await window.api.startBulk(data);
      if (!result.success && result.error) {
        setError(result.error);
        setIsProcessing(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setIsProcessing(false);
    }
  }, []);

  const stopBulk = useCallback(async () => {
    await window.api.stopBulk();
    setIsProcessing(false);
    setProgress({ current: 0, total: 0 });
  }, []);

  return {
    isRunning,
    isProcessing,
    progress,
    logs,
    sendMessage,
    startService,
    stopService,
    startBulk,
    stopBulk,
    error,
  };
};
