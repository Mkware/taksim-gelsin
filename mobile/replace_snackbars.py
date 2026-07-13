import os
import re

def process_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()
    
    if 'CustomSnackbar.show' in content or 'ScaffoldMessenger' not in content:
        return
        
    print(f"Processing {filepath}")
    
    # We will do some manual replacements for common patterns
    if 'import \'../../core/utils/snackbar_utils.dart\';' not in content and 'import \'../../../core/utils/snackbar_utils.dart\';' not in content:
        # add import after material
        depth = filepath.count('/') - 1
        if depth == 2: # lib/screens/main.dart (1) -> depth from lib is actually filepath.split('lib/')[1].count('/')
            import_path = "'core/utils/snackbar_utils.dart'"
        else:
            slashes = filepath.split('lib/')[1].count('/')
            import_path = "'" + "../" * slashes + "core/utils/snackbar_utils.dart'"
        
        content = re.sub(r"(import 'package:flutter/material.dart';)", r"\1\nimport " + import_path + ";", content)
    
    with open(filepath, 'w') as f:
        f.write(content)

for root, dirs, files in os.walk('lib'):
    for file in files:
        if file.endswith('.dart'):
            process_file(os.path.join(root, file))
