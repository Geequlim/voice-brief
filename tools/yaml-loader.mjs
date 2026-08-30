import yaml from 'js-yaml';

/** 将 YAML 以解析后的对象作为默认导出，等价于 Vite 侧的 @rollup/plugin-yaml */
export default function yamlLoader(source) {
	return `export default ${JSON.stringify(yaml.load(source))}`;
}
