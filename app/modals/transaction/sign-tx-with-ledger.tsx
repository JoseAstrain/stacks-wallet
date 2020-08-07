import React, { FC, useState, useRef, useCallback, useEffect } from 'react';
import { LedgerConnectInstructions } from '../../components/ledger/ledger-connect-instructions';
import TransportNodeHid from '@ledgerhq/hw-transport-node-hid';
import { LedgerConnectStep } from '../../pages/onboarding';
import type Transport from '@ledgerhq/hw-transport';
import { useInterval } from '../../hooks/use-interval';
import BlockstackApp from '@zondax/ledger-blockstack';
import { delay } from '../../utils/delay';
import { ERROR_CODE } from '@zondax/ledger-blockstack/src/common';
import { Box } from '@blockstack/ui';

const STX_DERIVATION_PATH = `m/44'/5757'/0'/0/0`;
interface SignTxWithLedgerProps {
  onConfirmPublicKey(key: Buffer, app: BlockstackApp): void;
}
export const SignTxWithLedger: FC<SignTxWithLedgerProps> = ({ onConfirmPublicKey }) => {
  const [step, setStep] = useState(LedgerConnectStep.Disconnected);
  const [loading, setLoading] = useState(false);
  const transport = useRef<Transport | null>(null);
  const disconnectTimeouts = useRef<number>(0);
  const listeningForAddEvent = useRef(true);

  const SAFE_ASSUME_REAL_DEVICE_DISCONNECT_TIME = 1000;
  const POLL_LEDGER_INTERVAL = 250;

  const createListener = useCallback(() => {
    console.log('creating listener');
    const tHid = TransportNodeHid.listen({
      next: async (event: any) => {
        console.log(event);
        if (event.type === 'add') {
          console.log('clearing timeout id', disconnectTimeouts.current);
          clearTimeout(disconnectTimeouts.current);
          tHid.unsubscribe();
          const t = await TransportNodeHid.open(event.descriptor);
          listeningForAddEvent.current = false;
          transport.current = t;
          t.on('disconnect', async () => {
            console.log('disconnect event');
            listeningForAddEvent.current = true;
            transport.current = null;
            await t.close();
            console.log('starting timeout');
            const timer = setTimeout(() => {
              console.log('running disconnect timeout');
              setStep(LedgerConnectStep.Disconnected);
            }, SAFE_ASSUME_REAL_DEVICE_DISCONNECT_TIME);
            console.log('timeout timer', timer);
            disconnectTimeouts.current = timer;
            createListener();
          });
        }
      },
      error: () => ({}),
      complete: () => ({}),
    });
    return tHid;
  }, []);

  useEffect(() => {
    const subscription = createListener();
    return () => {
      subscription.unsubscribe();
      if (transport.current) {
        void transport.current.close();
        transport.current = null;
      }
    };
  }, [createListener]);

  useInterval(() => {
    if (
      transport.current &&
      step !== LedgerConnectStep.HasAddress &&
      !listeningForAddEvent.current
    ) {
      console.log('Polling');
      // There's a bug with the node-hid library where it doesn't
      // fire disconnect event until next time an operation using it is called.
      // Here we poll a request to ensure the event is fired
      void new BlockstackApp(transport.current)
        .getVersion()
        .then(resp => {
          if (resp.returnCode === 0x6e00) return setStep(LedgerConnectStep.ConnectedAppClosed);
          if (resp.returnCode === 0x9000) return setStep(LedgerConnectStep.ConnectedAppOpen);
        })
        .catch(() => ({}));
    }
  }, POLL_LEDGER_INTERVAL);

  async function handleLedger() {
    const usbTransport = transport.current;

    if (usbTransport === null) return;

    const app = new BlockstackApp(usbTransport);

    try {
      await app.getVersion();

      const confirmedResponse = await app.showAddressAndPubKey(STX_DERIVATION_PATH);
      if (confirmedResponse.returnCode !== ERROR_CODE.NoError) {
        console.log(`Error [${confirmedResponse.returnCode}] ${confirmedResponse.errorMessage}`);
        return;
      }
      console.log(confirmedResponse);
      if (confirmedResponse.publicKey) {
        onConfirmPublicKey(confirmedResponse.publicKey as any, app);
        setLoading(true);
        setStep(LedgerConnectStep.HasAddress);
        await delay(1250);
        // dispatch(
        //   setLedgerAddress({
        //     address: confirmedResponse.address,
        //     onSuccess: () => history.push(routes.HOME),
        //   })
        // );
      }
    } catch (e) {
      console.log(e);
    }
    // await app.sign()
  }
  return (
    <Box mx="extra-loose" mb="extra-loose">
      <button onClick={handleLedger}>click</button>
      <LedgerConnectInstructions step={step} />
    </Box>
  );
};
