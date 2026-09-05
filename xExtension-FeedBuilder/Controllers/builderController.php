<?php
declare(strict_types=1);
use FeedBuilder\{Document,Client,Builder};
final class FreshExtension_builder_Controller extends FreshRSS_ActionController {
    public function firstAction(): void {
        if (!FreshRSS_Auth::hasAccess()) { Minz_Error::error(403); return; }
    }
    public function indexAction(): void {
        $this->_csp(['default-src'=>"'self'",'style-src'=>"'self' 'unsafe-inline'",'img-src'=>'https: http: data:','frame-src'=>"'self'"]);
        $this->view->categories = FreshRSS_Factory::createCategoryDao()->listCategories(false);
        $this->view->feeds = array_values(array_filter(FreshRSS_Factory::createFeedDao()->listFeeds(), fn($f) => $f->attributeArray('feedBuilder') !== null || $f->attributeBoolean('feedBuilderEditor') === true));
    }
    private function snapshot(array $input): array {
        $slot = ($input['slot'] ?? '') === 'full' ? 'full' : 'list';
        $page = (new Client())->page($input['url'], ($input['render'] ?? false) === true, '', true);
        $key = bin2hex(random_bytes(16));
        Minz_Session::_param('feedBuilder_' . $slot, $page + ['key'=>$key,'time'=>(string)time()]);
        $doc = new Document($page['html'],$page['url']);
        return ['key'=>$key,'html'=>$doc->preview(),'url'=>$page['url']];
    }
    private function document(array $input): Document {
        $slot = ($input['slot'] ?? '') === 'full' ? 'full' : 'list';
        $page = Minz_Session::paramArray('feedBuilder_' . $slot);
        if (!isset($page['key']) || !hash_equals($page['key'], $input['key'] ?? '') || $page['time']<time()-1800) throw new InvalidArgumentException('プレビューの期限が切れました。再取得してください');
        return new Document($page['html'],$page['url']);
    }
    private function discover(string $url): array {
        $client = new Client(); $page = $client->page($url);
        $check = static function(array $page): ?array {
            $pie = new FreshRSS_SimplePieCustom(); $pie->set_raw_data($page['html']); $pie->enable_cache(false);
            // No network autodiscovery inside SimplePie: all candidate fetches go through the guarded service.
            $pie->set_autodiscovery_level(\SimplePie\SimplePie::LOCATOR_NONE);
            if (!@$pie->init() || $pie->error()) return null;
            return ['url'=>$page['url'],'title'=>strip_tags($pie->get_title() ?: $page['url'])];
        };
        $direct=$check($page); if($direct!==null) return ['candidates'=>[$direct],'render'=>false,'errors'=>0];
        $found=[]; $seen=[]; $errors=0;
        foreach ([false,true] as $render) {
            if($render) $page=$client->page($url,true);
            foreach ((new Document($page['html'],$page['url']))->candidates() as $candidate) {
                if(isset($seen[$candidate]))continue; $seen[$candidate]=true;
                try {$feed=$check($client->page($candidate));if($feed!==null)$found[$feed['url']]=$feed;} catch(Throwable $e){$errors++;}
            }
            if($found) return ['candidates'=>array_values($found),'render'=>$render,'errors'=>$errors];
        }
        return ['candidates'=>[],'render'=>true,'errors'=>$errors];
    }
    public function apiAction(): void {
        if (!Minz_Request::isPost() || !FreshRSS_Auth::isCsrfOk()) {http_response_code(403);exit;}
        header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store');
        try {
            $raw=Minz_Request::paramString('payload',true);
            if(strlen($raw)>32768)throw new InvalidArgumentException('要求が大きすぎます');
            $input=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
            if(!is_array($input))throw new InvalidArgumentException('要求が不正です');
            $result=match($input['op'] ?? '') {
                'discover'=>$this->discover($input['url']),
                'snapshot'=>$this->snapshot($input),
                'select'=>$this->select($input),
                'preview'=>$this->preview($input),
                'save'=>$this->save($input),
                'load'=>$this->loadConfig((int)($input['id']??0)),
                default=>throw new InvalidArgumentException('未対応の操作です'),
            };
            echo json_encode($result,JSON_THROW_ON_ERROR|JSON_INVALID_UTF8_SUBSTITUTE);
        } catch(Throwable $e){http_response_code(422);echo json_encode(['error'=>$e->getMessage()],JSON_INVALID_UTF8_SUBSTITUTE);}
        exit;
    }
    private function select(array $input): array {
        $doc=$this->document($input);$id=(string)($input['node']??'');$field=$input['field']??'item';
        if(!in_array($field,['item','itemTitle','itemUri','itemContent','itemTimestamp','itemThumbnail','fullContent']))throw new InvalidArgumentException('項目が不正です');
        if(isset($input['direction']))$id=$doc->related($id,$input['direction']);
        elseif($field==='item')$id=$doc->groupNode($id);
        $context=$input['context']??null;
        if($field!=='item' && $field!=='fullContent')$context=$doc->contextFor($id,$input['itemXPath']??'');
        $expr=$field==='item' ? $doc->selector($id,null,true) : $doc->fieldSelector($id,$field==='fullContent'?null:$context,$field);
        $ids=$doc->ids($field==='item' || $field==='fullContent' ? $expr : $doc->selector($id));
        return ['xpath'=>$expr,'node'=>$id,'ids'=>$ids,'context'=>$context];
    }
    private function preview(array $input): array {
        $config=Builder::validate($input['config']);$doc=$this->document($input);
        $items=$doc->items($config['xpath']);
        foreach($items as &$item)$item['content']=FreshRSS_SimplePieCustom::sanitizeHTML($item['content'],$item['link']);unset($item);
        $warnings=[];
        if($config['fullContent']!=='') {
            try{$items[0]['content']=(new Builder())->full($items[0],$config);}catch(Throwable $e){$warnings[]=$e->getMessage();}
        }
        return ['items'=>$items,'ids'=>$doc->ids($config['xpath']['item']),'warnings'=>$warnings];
    }
    private function loadConfig(int $id): array {
        $feed=FreshRSS_Factory::createFeedDao()->searchById($id);
        if($feed===null)throw new InvalidArgumentException('フィードが見つかりません');
        $config=$feed->attributeArray('feedBuilder');
        if($config===null && $feed->attributeBoolean('feedBuilderEditor')!==true)throw new InvalidArgumentException('このフィードは作成画面で編集できません');
        return ['id'=>$id,'url'=>$feed->url(),'title'=>$feed->name(),'category'=>$feed->categoryId(),'config'=>$config??['xpath'=>$feed->attributeArray('xpath')??[],'render'=>false,'fullRender'=>false,'fullContent'=>'']];
    }
    private function save(array $input): array {
        $url=$input['url']??''; $config=Builder::validate($input['config']); $builder=new Builder();
        // Re-fetch with exactly the saved selectors before any subscription mutation.
        $items=$builder->extract($url,$config);
        if($config['fullContent']!=='')$builder->full($items[0],$config);
        $title=trim($input['title']??'') ?: $url;
        $category=(int)($input['category']??1);
        $cat=FreshRSS_Factory::createCategoryDao()->searchById($category);
        if($cat===null || $cat->kind()===FreshRSS_Category::KIND_DYNAMIC_OPML)throw new InvalidArgumentException('カテゴリーを選択してください');
        $managed=$config['render'] || $config['fullContent']!=='';
        $kind=$managed?FreshRSS_Feed::KIND_RSS:FreshRSS_Feed::KIND_HTML_XPATH;
        $xpath=$config['xpath'];$xpath['itemUid']=$xpath['itemUri'];
        $attributes=['xpath'=>$xpath,'feedBuilder'=>$managed?$config:null,'feedBuilderEditor'=>true,'unicityCriteria'=>'link'];
        $id=(int)($input['id']??0);$dao=FreshRSS_Factory::createFeedDao();
        if($id>0) {
            $feed=$dao->searchById($id);
            if($feed===null || ($feed->attributeArray('feedBuilder')===null && $feed->attributeBoolean('feedBuilderEditor')!==true))throw new InvalidArgumentException('編集対象が不正です');
            if($feed->url()!==$url)throw new InvalidArgumentException('編集時は URL を変更できません。新規登録してください');
            foreach($attributes as $key=>$value)$feed->_attribute($key,$value);
            if(!$dao->updateFeed($id,['name'=>$title,'category'=>$category,'kind'=>$kind,'attributes'=>$feed->attributes()]))throw new RuntimeException('保存できませんでした');
        } else {
            if(count($dao->listFeeds())>=FreshRSS_Context::systemConf()->limits['max_feeds'])throw new InvalidArgumentException('フィード登録数の上限に達しています');
            if($dao->searchByUrl($url)!==null)throw new InvalidArgumentException('この URL は登録済みです。保存済み設定から編集してください');
            $feed=new FreshRSS_Feed($url);
            $feed->_name($title);$feed->_category($cat);$feed->_kind($kind);$feed->_attributes($attributes);$feed->_website($url);
            $feed=Minz_ExtensionManager::callHook(Minz_HookType::FeedBeforeInsert,$feed);
            if(!$feed instanceof FreshRSS_Feed)throw new RuntimeException('フィードの登録が取り消されました');
            $id=$dao->addFeedObject($feed);
            if(!$id)throw new RuntimeException('登録できませんでした');
            FreshRSS_UserDAO::touch();
        }
        return ['id'=>$id,'message'=>'設定を保存しました。記事は FreshRSS の更新処理で取得します。'];
    }
}
