import puppeteer, { Browser, Page } from 'puppeteer';
import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';

interface MessageLog {
  timestamp: string;
  phoneNumber: string;
  message: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
}

export class WhatsAppService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private mainWindow: BrowserWindow;
  private logs: MessageLog[] = [];
  private isBulkProcessing = false;
  private logsPath: string;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.logsPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.whatsapp-messenger', 'logs.json');
    this.loadLogs();
  }

  async start(): Promise<void> {
    try {
      console.log('🚀 Starting WhatsApp service...');
      
      this.browser = await puppeteer.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ],
        userDataDir: './whatsapp-session'
      });

      this.page = await this.browser.newPage();

      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );

      console.log('🌐 Opening WhatsApp Web...');
      await this.page.goto('https://web.whatsapp.com/', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000
      });

      console.log('⏳ Checking authentication status...');

      const sidePanelSelectors = [
        '#side',
        '[data-testid="chat-list"]',
        'div[aria-label*="Chat list"]',
        '[data-testid="chatlist-header"]',
        '#pane-side',
        'div._amid'
      ];

      const qrCodeSelectors = [
        'canvas[aria-label*="Scan"]',
        'canvas[aria-label*="QR"]',
        'div[data-ref]'
      ];

      let authenticated = false;
      let needsQRScan = false;
      let attempts = 0;
      const maxAttempts = 120;

      console.log('🔍 Quick check for existing session...');
      for (let i = 0; i < 5 && !authenticated; i++) {
        for (const selector of sidePanelSelectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              authenticated = true;
              console.log(`✅ Session found! Already logged in (selector: ${selector})`);
              break;
            }
          } catch (e) {
            // Continue
          }
        }

        if (!authenticated) {
          await this.delay(1000);
        }
      }

      if (!authenticated) {
        for (const selector of qrCodeSelectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              needsQRScan = true;
              console.log('📱 QR code detected - Please scan to login');
              break;
            }
          } catch (e) {
            // Continue
          }
        }
      }

      while (!authenticated && attempts < maxAttempts) {
        for (const selector of sidePanelSelectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              authenticated = true;
              if (needsQRScan) {
                console.log(`✅ QR code scanned successfully!`);
              }
              console.log(`✅ WhatsApp authenticated (selector: ${selector})`);
              break;
            }
          } catch (e) {
            // Continue
          }
        }

        if (!authenticated) {
          if (attempts === 0 && needsQRScan) {
            console.log(`⏳ Waiting for QR code scan...`);
          } else if (attempts % 10 === 0 && attempts > 0) {
            console.log(`⏳ Still waiting... (${attempts} seconds elapsed)`);
          }
          await this.delay(1000);
          attempts++;
        }
      }

      if (!authenticated) {
        throw new Error('WhatsApp Web did not load within the timeout period. Please try again.');
      }

      console.log('✅ WhatsApp loaded successfully');
      await this.delay(2000);

      this.mainWindow.webContents.send('whatsapp:ready');
      console.log('✅ Service ready - Event sent to renderer');
      
    } catch (error) {
      console.error('❌ Error starting service:', error);
      this.mainWindow.webContents.send('service:error', {
        errorMessage: (error as Error).message,
      });
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.isBulkProcessing = false;
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
    this.mainWindow.webContents.send('whatsapp:stopped');
    console.log('✅ WhatsApp service stopped');
  }

  async sendSingleMessage(phoneNumber: string, message: string): Promise<void> {
    if (!this.page || !this.browser) {
      throw new Error('WhatsApp service not running');
    }

    try {
      const cleanPhone = this.cleanPhoneNumber(phoneNumber);
      
      console.log(`\n========================================`);
      console.log(`📱 Opening chat for: ${phoneNumber}`);
      console.log(`========================================`);
      
      const chatUrl = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
      await this.page.goto(chatUrl, { 
        waitUntil: 'networkidle2',
        timeout: 40000 
      });
      
      console.log('⏳ Waiting 8 seconds for chat to fully load...');
      await this.delay(8000);

      console.log(`🔍 Current URL: ${this.page.url()}`);

      let chatName = 'Unknown';
      try {
        chatName = await this.page.evaluate(() => {
          const header = document.querySelector('[data-testid="conversation-info-header"]') as HTMLElement;
          return header ? header.innerText.trim() : 'Unknown';
        });
      } catch (e) {
        // Ignore
      }
      console.log(`👤 Chat name: ${chatName}`);

      const messageBoxSelectors = [
        'div[contenteditable="true"][data-tab="10"]',
        'div[contenteditable="true"][data-tab="6"]',
        'footer div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        '[data-testid="conversation-compose-box-input"]',
        'div[title="Type a message"]'
      ];

      let messageBox = null;
      
      console.log('🔍 Searching for message box...');
      for (let attempt = 0; attempt < 20; attempt++) {
        for (const selector of messageBoxSelectors) {
          try {
            messageBox = await this.page.$(selector);
            if (messageBox) {
              console.log(`✅ Found message box: ${selector}`);
              break;
            }
          } catch (e) {
            // Continue
          }
        }

        if (messageBox) break;

        console.log(`⏳ Message box not found, retry ${attempt + 1}/20...`);
        await this.delay(1000);
      }

      if (!messageBox) {
        const timestamp = Date.now();
        await this.page.screenshot({ path: `error-${cleanPhone}-${timestamp}.png` });
        console.error(`❌ Screenshot saved: error-${cleanPhone}-${timestamp}.png`);
        throw new Error(`Message box not found for ${phoneNumber} after 20 attempts`);
      }

      console.log('🖱️ Clicking message box...');
      await messageBox.click();
      await this.delay(1000);

      console.log('🧹 Clearing any existing text...');
      await this.page.keyboard.down('Control');
      await this.page.keyboard.press('KeyA');
      await this.page.keyboard.up('Control');
      await this.page.keyboard.press('Backspace');
      await this.delay(500);

      // PASTE using Clipboard API + Ctrl+V
      console.log('📋 Pasting message using clipboard...');

      try {
        // Copy to system clipboard
        await this.page.evaluate((text) => {
          return navigator.clipboard.writeText(text);
        }, message);
        
        await this.delay(300);
        
        // Focus the message box
        await this.page.evaluate(() => {
          const box = document.querySelector('footer div[contenteditable="true"]') as HTMLElement;
          if (box) {
            box.focus();
          }
        });
        
        await this.delay(200);
        
        // Simulate Ctrl+V to paste
        await this.page.keyboard.down('Control');
        await this.page.keyboard.press('KeyV');
        await this.page.keyboard.up('Control');
        
        await this.delay(1500);
        
        console.log('✅ Paste command executed');
        
      } catch (pasteError) {
        console.log('⚠️ Clipboard paste failed, using execCommand...');
        
        // Fallback: execCommand method
        await this.page.evaluate((msg) => {
          const box = document.querySelector('footer div[contenteditable="true"]') as HTMLElement;
          if (box) {
            box.focus();
            document.execCommand('insertText', false, msg);
          }
        }, message);
        
        await this.delay(1500);
      }

      // Verify message is in the box
      const finalText = await this.page.evaluate(() => {
        const box = document.querySelector('footer div[contenteditable="true"]') as HTMLElement;
        return box ? (box.innerText || box.textContent || '').trim() : '';
      });

      console.log(`📝 Text in box: "${finalText.substring(0, 50)}${finalText.length > 50 ? '...' : ''}"`);

      if (!finalText || finalText.length === 0) {
        console.error('❌ Failed to paste message!');
        throw new Error('Failed to paste message into chat box');
      }

      console.log('📤 Pressing Enter to send...');
      await this.page.keyboard.press('Enter');
      await this.delay(3000);

      const afterSendText = await this.page.evaluate(() => {
        const box = document.querySelector('footer div[contenteditable="true"]') as HTMLElement;
        return box ? (box.innerText || box.textContent || '').trim() : '';
      });

      if (afterSendText && afterSendText.length > 0) {
        console.warn(`⚠️ WARNING: Message still in box: "${afterSendText}"`);
        throw new Error('Message was not sent - still in input box');
      }

      console.log('✅ Message box cleared - message sent successfully!');

      this.addLog(phoneNumber, message, 'success');
      this.mainWindow.webContents.send('message:sent', {
        phoneNumber,
        status: 'success',
      });

      console.log(`✅ SUCCESS: Message sent to ${phoneNumber} (${chatName})`);
      console.log(`========================================\n`);
      
    } catch (error) {
      const errorMsg = (error as Error).message;
      console.error(`\n❌ FAILED: ${phoneNumber}`);
      console.error(`❌ Error: ${errorMsg}`);
      console.error(`========================================\n`);
      
      this.addLog(phoneNumber, message, 'failed', errorMsg);
      this.mainWindow.webContents.send('message:failed', {
        phoneNumber,
        error: errorMsg,
      });
      throw error;
    }
  }

  async sendBulkMessages(data: Array<{ phone_number: string; message: string }>): Promise<void> {
    this.isBulkProcessing = true;
    const total = data.length;
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < total; i++) {
      if (!this.isBulkProcessing) {
        console.log('⚠️ Bulk messaging cancelled');
        break;
      }

      const { phone_number, message } = data[i];

      try {
        await this.sendSingleMessage(phone_number, message);
        successCount++;

        this.mainWindow.webContents.send('bulk:progress', {
          current: i + 1,
          total,
          phoneNumber: phone_number,
          status: 'success',
        });
      } catch (error) {
        failedCount++;

        this.mainWindow.webContents.send('bulk:progress', {
          current: i + 1,
          total,
          phoneNumber: phone_number,
          status: 'failed',
        });
      }

      const delayTime = Math.floor(Math.random() * 3000) + 2000;
      await this.delay(delayTime);
    }

    this.isBulkProcessing = false;
    this.mainWindow.webContents.send('bulk:completed', {
      successCount,
      failedCount,
      logs: this.logs,
    });

    console.log(`✅ Bulk completed: ${successCount} success, ${failedCount} failed`);
  }

  stopBulk(): void {
    this.isBulkProcessing = false;
    console.log('⚠️ Stopping bulk messaging...');
  }

  private cleanPhoneNumber(phone: string): string {
    return String(phone).replace(/\D/g, '');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private addLog(phoneNumber: string, message: string, status: 'success' | 'failed' | 'skipped', error?: string): void {
    const log: MessageLog = {
      timestamp: new Date().toISOString(),
      phoneNumber,
      message,
      status,
      error,
    };
    this.logs.push(log);
    this.saveLogs();
  }

  private saveLogs(): void {
    try {
      const dir = path.dirname(this.logsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.logsPath, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (error) {
      console.error('❌ Error saving logs:', error);
    }
  }

  private loadLogs(): void {
    try {
      if (fs.existsSync(this.logsPath)) {
        const data = fs.readFileSync(this.logsPath, 'utf-8');
        this.logs = JSON.parse(data);
        console.log(`📋 Loaded ${this.logs.length} log entries`);
      }
    } catch (error) {
      console.error('❌ Error loading logs:', error);
      this.logs = [];
    }
  }

  getLogs(): MessageLog[] {
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];
    this.saveLogs();
    console.log('🗑️ Logs cleared');
  }
}
