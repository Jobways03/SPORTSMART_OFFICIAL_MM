import { Injectable, Logger } from '@nestjs/common';
import { WhatsAppClient } from '../clients/whatsapp.client';
import { redactPhone } from '../../../bootstrap/logging/log-redact';

@Injectable()
export class WhatsAppAdapter {
  private readonly logger = new Logger(WhatsAppAdapter.name);

  constructor(private readonly client: WhatsAppClient) {}

  /**
   * Send an order confirmation via WhatsApp.
   */
  async sendOrderConfirmation(
    phoneNumber: string,
    orderNumber: string,
    totalAmount: number,
  ): Promise<void> {
    if (!this.client.isConfigured) return;

    try {
      await this.client.sendTextMessage(
        phoneNumber,
        `Your order ${orderNumber} has been placed successfully! Total: ₹${totalAmount}. Track your order at our website.`,
      );
      this.logger.log(
        `Order confirmation sent to ${redactPhone(phoneNumber)} for ${orderNumber}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp order confirmation: ${(error as Error).message}`);
    }
  }

  /**
   * Send a delivery update via WhatsApp.
   */
  async sendDeliveryUpdate(
    phoneNumber: string,
    orderNumber: string,
    status: string,
    trackingUrl?: string,
  ): Promise<void> {
    if (!this.client.isConfigured) return;

    try {
      let message = `Update for order ${orderNumber}: ${status}`;
      if (trackingUrl) message += `\nTrack: ${trackingUrl}`;

      await this.client.sendTextMessage(phoneNumber, message);
      this.logger.log(
        `Delivery update sent to ${redactPhone(phoneNumber)}: ${status}`,
      );
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp delivery update: ${(error as Error).message}`);
    }
  }

  /**
   * Send an OTP via WhatsApp.
   */
  async sendOtp(phoneNumber: string, otp: string): Promise<void> {
    if (!this.client.isConfigured) return;

    try {
      await this.client.sendTextMessage(
        phoneNumber,
        `Your SPORTSMART verification code is: ${otp}. Valid for 10 minutes. Do not share this code.`,
      );
      this.logger.log(`OTP sent to ${redactPhone(phoneNumber)}`);
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp OTP: ${(error as Error).message}`);
    }
  }

  /**
   * Send a generic notification message.
   */
  async sendNotification(phoneNumber: string, message: string): Promise<void> {
    if (!this.client.isConfigured) return;

    try {
      await this.client.sendTextMessage(phoneNumber, message);
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp notification: ${(error as Error).message}`);
    }
  }
}
