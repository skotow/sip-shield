import subprocess
import unittest
from unittest.mock import patch
from table_worker import rpc

class RpcTests(unittest.TestCase):
    def test_rpc_fault_with_successful_cli_exit_is_rejected(self):
        with patch('table_worker.subprocess.run',return_value=subprocess.CompletedProcess([],0,'error: 500 - Reload failed.','')):
            with self.assertRaisesRegex(RuntimeError,'permissions.addressReload'):
                rpc('permissions.addressReload')

    def test_transport_failure_is_rejected(self):
        with patch('table_worker.subprocess.run',return_value=subprocess.CompletedProcess([],1,'','connect failed')):
            with self.assertRaises(RuntimeError): rpc('dispatcher.reload')

    def test_successful_reply_is_returned(self):
        with patch('table_worker.subprocess.run',return_value=subprocess.CompletedProcess([],0,'OK','')):
            self.assertEqual(rpc('dispatcher.reload'),'OK')

if __name__=='__main__': unittest.main()
