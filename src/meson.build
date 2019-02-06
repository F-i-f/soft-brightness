extension_metadata = vcs_tag(command:  ['git', 'rev-parse', 'HEAD'],
			     input:    files('metadata.json.in'),
			     output:   'metadata.json',
			     fallback: 'unknown')
extension_data += extension_metadata.full_path()
