"""Makes the protected test fixtures from tests/fixtures/lecture-enzymes.pdf:

- lecture-password.pdf: needs the password "study123" to open.
- lecture-restricted.pdf: opens without a password but is encrypted with an
  owner password that restricts copying and editing, like many published
  books. Opening it needs the decryption code path, which failed on browsers
  without the newest JavaScript built-ins before the switch to pdf.js's
  legacy build.

Both use RC4 128-bit, which pdf.js reads. Test-only helper; needs pypdf
(pip install pypdf). Run from the repository root:
python scripts/make-protected-pdfs.py
"""
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions

root = Path(__file__).resolve().parent.parent
fixtures = root / "tests" / "fixtures"
source = fixtures / "lecture-enzymes.pdf"

for name, user, owner, permissions in [
    ("lecture-password.pdf", "study123", "owner-study123", UserAccessPermissions.all()),
    ("lecture-restricted.pdf", "", "publisher-owner", UserAccessPermissions.PRINT),
]:
    writer = PdfWriter(clone_from=PdfReader(source))
    writer.encrypt(user_password=user, owner_password=owner, algorithm="RC4-128", permissions_flag=permissions)
    target = fixtures / name
    with target.open("wb") as f:
        writer.write(f)
    print(f"wrote {target.relative_to(root)} ({target.stat().st_size} bytes)")
